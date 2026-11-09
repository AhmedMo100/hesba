# ADR-0018: Sandwiches as composite products

- **Status:** Proposed
- **Date:** 2026-11-09
- **Decision-maker:** Project owner (approval pending)

## Context

Shops sell sandwiches made from things they already stock: bread, luncheon, cheese, and so on. The owner wants to:

- define each sandwich once as a recipe;
- see its cost and profit;
- sell it like any product;
- have each sale consume the ingredients from stock.

Constraints found in the code (2026-11-09):

- **Stock lives on `store_variants`.** It is kept as batches plus append-only `stock_movements` plus the `stock_levels` cache, in integer base units: grams for `kg`/`g` products, otherwise one unit of the product.
- **Money is integer piasters.** The pure FEFO engine is `domain/stock/stock-engine.ts`.
- **Registered purchase price.** `store_products.buy_price_piasters` and `store_variants.buy_price_piasters` hold the price per selling unit: per kg for `kg`, per gram for `g`, otherwise per piece.
  - A pack (a bread bag of 10) is registered as `piece` with `pack_qty = 10`. The product form divides the pack price by the pack size, so the stored price is per piece.
- **Batch costs are unreliable.**
  - The Add-Stock screen writes the batch's **total** cost into `store_stock_batches.cost_price_minor`.
  - The FEFO engine and initial-stock path treat that column as a **per-unit** cost.
  - Its meaning is therefore inconsistent, so it cannot be the cost basis. This is logged in `docs/audits/USER-FACING-ERRORS.md` (UE-19) and not fixed here.
- **The ordinary sale path is broken.**
  - `POST /api/sales` records no stock for ordinary products.
  - It fails for variant sales (K1).
  - Undo is a hard delete that the database refuses (K3).
  - Fixing these is roadmap Phases 1–3 and out of scope.
- **`sale_lines` targets.** `chk_sale_lines_exactly_one_target` requires each line to point at exactly one of product, variant, card or bill.
- **No offline outbox exists.** Every write needs the server.

## Options

1. **A sandwich is a variant of one shared "Sandwich" product.** This reuses the variant UI, but every sandwich would need stock of its own and its own recipe anyway. It mixes unrelated items.
2. **A sandwich is a normal product with its own stock that the owner "produces".** This is simple to sell, but it needs a production step the owner does not want, and the ingredient stock would be wrong until production is recorded.
3. **A sandwich is a store product of `kind = 'sandwich'` with no variant and no stock, plus a recipe table.** Selling it consumes the ingredients directly.

## Decision

Option 3.

**Data (migration `20261109000000_sandwich_products`, additive):**

- `store_products.kind`: `'standard'` (the default) or `'sandwich'`, enforced by a check constraint.
- `sandwich_ingredients`: `store_id`, `sandwich_product_id`, `ingredient_variant_id`, `quantity_base` (integer > 0) and `position`.
  - The pair (sandwich, ingredient) is unique.
  - FORCE RLS with the standard `tenant_isolation` policy.
  - A trigger rejects lines whose sandwich or ingredient belongs to another store, whose parent is not a sandwich, or whose ingredient is a sandwich. Foreign keys are checked without RLS, so the trigger closes that gap.
- `sale_lines.cost_piasters` (nullable): the cost of the whole line at the moment of sale.

**Cost:**

- Each line costs `quantity_base × purchase price`, with the price taken from the variant, else from the product.
  - For `kg` products the price is per 1000 g. For `g` products and pieces it is per unit.
- Lines are summed exactly in milli-piasters (`bigint`), then **rounded once, half up**. No floats.
- Example: bread 1 × 3.00 + luncheon 5 g × 200/kg + cheese 5 g × 160/kg = 4.80 ج.
- The current cost is **never stored**. It is recalculated from today's purchase prices on every read, so it follows price changes.
- An ingredient with no purchase price counts as 0 and is flagged in the UI.

**Units:**

- Recipe amounts are integer base units. Grams (or kilos converted to grams) apply to weighed goods; whole pieces apply to everything else.
- A sub-gram amount (0.5 g) is rejected, not rounded, matching the stock ledger's precision.
- A product sold only as a whole bag or carton is consumed in whole bags or cartons.

**Selling** reuses `POST /api/sales` and its transaction. `recordSale` detects a sandwich and, inside the same `withTenant` transaction:

1. Returns the existing sale when the client's `opId` was already recorded.
2. Locks the ingredients' `stock_levels` rows (`SELECT … FOR UPDATE`, in id order).
3. Rejects the whole sale (409, with `details.shortages`) if any ingredient is short. Nothing is deducted, and stock never goes below zero on this path.
4. Writes the sale and **one** line that targets only the sandwich product, at the sandwich's current price, with `cost_piasters` = current recipe cost × count.
5. FEFO-depletes each ingredient through `depleteVariantFefoInTx`, the transaction-level core taken out of `InventoryService.depleteStockForSale`. This writes `type: "sale"` movements linked to the line.

The server prices the sale; the client's amount is ignored.

**Editing** replaces the name, price and recipe lines. **History** is preserved:

- each past sale keeps its own price, cost snapshot and ingredient movements;
- recipe lines are configuration, not history.

**Hiding** reuses the products hide path. A hidden sandwich cannot be sold; its past sales still list. The sandwich row is never deleted.

**Sandwiches never reach the community catalog.** They bypass `upsertStoreProduct`, which now refuses to edit a sandwich.

**Online only.** Creating, editing and selling a sandwich need the server:

- the form and the sales tile say so when offline;
- a sandwich sale shows success only after the server accepts it;
- no outbox is faked.

The design stays compatible with a future outbox: the sale already carries a client `opId` and is idempotent.

## Consequences

- **Positive:**
  - Ingredient stock is always the real stock.
  - Sale and consumption are atomic and idempotent.
  - Cost follows prices; history is frozen.
  - Recipes are tenant-isolated in both the app and the database.
- **Negative / risks:**
  - The sandwich path is the only sale path that touches stock. Ordinary sales still deduct stock with a separate client request (UE-01) until roadmap Phase 1.
  - Row locks cover sandwich sales only. A concurrent ordinary `adjust` on the same ingredient is still unlocked (UE-07).
  - Sandwich sales have **no undo**, because `sale.void` is roadmap Phase 3. The UI shows no Undo button for them.
  - The Home dashboard does not read `sale_lines.cost_piasters` yet, so its profit figures do not include sandwich costs.
  - FEFO marks quantity drawn beyond the batches (stock added by `adjust` without a batch) as `negative`, even when the level covers it. This is existing stock-engine behavior.
  - The cost basis is the registered purchase price, not the cost of the batch actually consumed, because batch cost semantics are inconsistent (UE-19).
- **Deployment order:** the migration must be applied before this code runs against a database. The regenerated Prisma client selects `store_products.kind` on every product query. Running the code without the migration fails every product and sandwich read with Prisma `P2022` (`column store_products.kind does not exist`) → HTTP 500. That is what happened on the Neon dev database until the migration was applied there on 2026-11-09.

  **A running dev server must also be restarted after `prisma generate`.** Next.js loads `@prisma/client` as an external Node module once, at startup. A server started before generation keeps the old client, which knows neither `kind` nor `sandwich_ingredients`, so every sandwich query keeps failing with 500 even after the database is fixed. That was the remaining cause of the 500s on the dev server: the `pnpm dev` process started on 2026-11-08 at 16:49 had not been restarted.
- **What changed:**
  - `docs/03-data.md` (Part 1 §3 and §5) and `docs/01-product.md` (decisions/assumptions).
  - `docs/audits/USER-FACING-ERRORS.md` (UE-19).
- **Revisit when:**
  - Phase 1 makes ordinary sales atomic: fold both paths into one.
  - Phase 3 adds `sale.void`: add undo for sandwiches.
  - Batch costs are made per-unit: consider FEFO-cost snapshots instead of registered prices.
