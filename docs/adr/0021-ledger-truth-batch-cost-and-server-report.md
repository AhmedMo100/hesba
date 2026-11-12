# ADR-0021: Ledger as stock truth, one batch cost model, and a server-side Home report

- **Status:** Proposed
- **Date:** 2026-11-11
- **Decision-maker:** Project owner (approval pending)
- **Fixes:** audit QA-05, QA-06, QA-07, QA-08 (`docs/QA/FULL-SYSTEM-AUDIT.md`); UE-05, UE-19
- **Builds on:** ADR-0019 (stock row locks), ADR-0020

## Context

**QA-05: three answers for one product's stock.** For the same product, `stock_levels`, the sum of batch remaining quantities, and the movement ledger disagreed. The causes, confirmed in the code:

- **Waste without a chosen batch** decreased the level and wrote a movement, but never touched any batch.
- **Waste on a chosen batch** clamped that batch at 0 while the level dropped by the full quantity.
- **Earlier races** (fixed by ADR-0019) left corrupted rows behind.
- **The lock returned the cache** (`stock_levels`), so a corrupted cache was carried forward instead of corrected.

**QA-08: cost stored as a total, read as per-unit.**

- The Add Stock screen asks for the **total** paid and sent it as `costPricePiasters`. The server stored it in `cost_price_minor` and computed `cost_total_minor = cost × quantity`.
- Every reader treated `cost_price_minor` as a unit cost: FEFO costs, the movement log, alerts, stock and Home valuation, and the AI profit tool.
- Home's "purchases" multiplied the total by the remaining quantity: 4,264 EGP instead of 380 EGP.
- Initial-stock and adjustment batches stored a per-kg price but multiplied it by grams (1000× too high for `kg` products).

**QA-06: Home always showed zero.** Home read `createdAt` / `totalPiasters` / `items` from `/api/sales` and `createdAt` / `amountPiasters` from `/api/expenses`. The APIs send `timestamp` / `amountPiasters` and `created_at` / `amount_piasters`, so every record was filtered out as an invalid date.

**QA-07: Home invented money.** COGS was 75% of revenue when it couldn't match a product by **name**, and the chart, top-product and category profits were 25% of revenue.

## Decision

### 1. The movement ledger is the source of truth for quantities

- **Lock and read the ledger.** `lockStockLevelsInTx` keeps its lock (the same row, the same id order) but now returns Σ `stock_movements.quantity_base` read under that lock. Every writer computes from it and writes the result into `stock_levels`, so a stale cache is corrected by the next write.
- **One take path.** Every decrease goes through `takeStockInTx`: sales, sandwich and promotion takes, waste, decreasing adjustments and clear. It:
  - takes FEFO from batches, or only from the chosen batch;
  - writes one movement per batch part, carrying the batch's unit cost;
  - writes the new ledger balance into the cache.
- **Increases always create a batch** with a matching movement: purchase, initial stock, adjustment.
- **Waste above the stock, or above the chosen batch, is refused (409).** Batches can't go negative, so accepting it would break the invariant. Previously it was silently clamped or left unmatched.
- **Reconciliation check:** `InventoryService.getStockReconciliation` and `GET /api/stock?view=reconcile` report, per variant, level / Σ batches / ledger and whether they agree. The check only reports; it never repairs.

### 2. One batch cost model (QA-08)

| Column | Meaning |
|---|---|
| `store_stock_batches.cost_total_minor` | What was paid for the received quantity. **The authority.** `NULL` = unknown. |
| `store_stock_batches.cost_price_minor` | Unit cost per **selling** unit (per kg for `kg`, per gram for `g`, per piece otherwise), the same basis as `buy_price_piasters`. Derived from the total, rounded half up. Now nullable; `NULL` = unknown. |
| `stock_movements.cost_price_minor` | The batch's unit cost, for movements written from now on. |
| `waste_records.cost_minor` | The wasted quantity's share of the batch total. |
| `sale_lines.cost_piasters` | Cost recorded at sale time (see 3). |

- **Parts of a batch** cost their share of the total, computed exactly in milli-piasters and rounded once (`src/domain/stock/batch-cost.ts`). Selling all 3 of a "3 for 10.00" batch costs exactly 10.00.
- **API:** `POST /api/stock` accepts `costTotalPiasters`. The old `costPricePiasters` is kept as a deprecated alias that means the **total**, which is what clients always sent.
- **The Add Stock screen** sends `costTotalPiasters`. A product it creates gets its buy price per selling unit from the same rule; before, it was per gram for weighed goods.
- **Initial stock and stock increases** are costed from the registered buy price per selling unit, or unknown when there is none (never 0).

### 3. Recorded sale cost (QA-07)

- **Ordinary and promotion lines** store the cost of what the FEFO take consumed, from the batches' recorded totals. It is `NULL` if any part's cost is unknown.
- **Sandwich lines** keep their ADR-0018 snapshot.
- **Service lines** paid through a machine store the machine charge; otherwise `NULL`.

### 4. A server-side Home report (QA-06, QA-07)

- **Endpoint:** `GET /api/reports/home?period=today|yesterday|week|month|all`, in the new `modules/reports`, which `docs/02-arch.md` already lists as a planned module.
- **Revenue:** Σ `sales.total_piasters`.
- **COGS:** Σ `sale_lines.cost_piasters`. **Unknown (`null`) if any sale in the group has no recorded cost**; the recorded part is also returned, so the screen can say how many sales lack a cost.
- **Expenses:** Σ non-deleted expenses, by `spent_at`.
- **Purchases:** Σ `cost_total_minor` of batches received by purchase or initial stock in the period.
- **The rest:** the hourly or daily series, top products (by product id), categories and activity.
- **Periods** are Cairo calendar days.
- **One contract:** the response is validated against `src/schemas/report.ts` on the server, and the client parses it with the same schema (`parseHomeReport`), so a renamed field fails loudly instead of showing zeros.
- **Home does no financial arithmetic.** An unknown cost or profit is shown as "—".
- **The AI profit tool** uses the same recorded-cost function.

### 5. Backfill: migration `20261111000000_batch_cost_semantics_and_stock_reconcile`

The migration is deterministic and runs per store with `app.store_id` set, so RLS applies.

1. `cost_price_minor` becomes nullable.
2. **Batch cost**, classified by the movement that **created** the batch:
   - **`purchase`** (Add Stock): the stored value was the total, so `cost_total := old value` and the unit cost is derived from it.
   - **`initial_stock`, `adjustment`, or no creating movement:** the stored value was the registered unit price, so it is kept as the unit cost and the total is recomputed as unit × quantity ÷ (1000 for `kg`). A stored 0 meant "no price registered" and becomes unknown (`NULL`); no cost is invented.
3. **Historical `stock_movements` are not rewritten.** The ledger is append-only. They keep the value recorded at the time, and cost readers use the batch total instead.
4. **Waste tied to a batch** is re-costed as its share of the corrected total.
5. **Quantities:**
   - the ledger is kept as the truth;
   - batch excess over the ledger is removed FEFO;
   - a batch deficit becomes a `RECON-QA05` batch with **unknown** cost;
   - `stock_levels` is set to the ledger value.
6. **Sale lines with no cost** get the cost of their recorded batch takes, only when every part is known. Sandwich lines are not touched.

## Consequences

- **Positive:**
  - Level = batches = ledger holds through every mutation path (tested), and a drifted cache heals on the next write.
  - Purchases, valuation, FEFO costs and profit use one unambiguous cost model.
  - Home shows the real figures and never invents cost or profit.
- **Negative / risks:**
  - Every stock write now sums the variant's ledger under the lock. The `(store_id, store_variant_id, created_at)` index covers it, but very long histories make it slower; a snapshot column can come later.
  - Waste beyond the stock is now refused instead of clamped.
  - Batches created by the Add Stock API with a *per-unit* value (not the UI) are misread as totals by the backfill. No such client exists in the codebase.
  - Older movements keep their old `cost_price_minor`.
  - The report loads all sales of the period in one query. That's fine at shop scale; very long periods would need SQL aggregation.
  - Adjustment increases without a registered price produce unknown costs, which makes the period's COGS unknown until a price is set.
- **Still open:** the oversell clamp in `adjust` (QA-16), and the client-side valuation on the Stock and Home "الجرد" tabs, which uses registered buy prices.
