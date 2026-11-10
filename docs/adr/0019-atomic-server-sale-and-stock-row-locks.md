# ADR-0019: Atomic server-side sale and stock row locks

- **Status:** Proposed
- **Date:** 2026-11-10
- **Decision-maker:** Project owner (approval pending)
- **Fixes:** audit QA-01 and QA-02 (`docs/QA/FULL-SYSTEM-AUDIT.md`); earlier UE-01, UE-07, K1, K2

## Context

The 2026-11-09 audit reproduced two problems on the running app and in the database.

**QA-01: an ordinary sale was two independent client requests.**

- `POST /api/stock` (adjust −qty) deducted stock and succeeded.
- `POST /api/sales` always failed with 500. Its line set both `store_variant_id` and `store_product_id`, which violates `chk_sale_lines_exactly_one_target`.
- The screen showed success anyway. Stock went down and no sale was ever saved.
- Promotion sales did the same, with a body the server rejected (400).
- The client also chose the amount and the timestamp.

**QA-02: lost updates on concurrent stock writes.**

- Every inventory method read `stock_levels` (and batches) and then wrote the computed value, under READ COMMITTED, with no lock.
- 10 parallel −1 adjustments from 100 ended at 98.
- 8 parallel +100 g additions ended 700 g short.
- Each lost update left a wrong `balance_after_base` in the append-only ledger.

The sandwich sale (ADR-0018) was the only path that did this right: one transaction, `SELECT … FOR UPDATE` on the ingredients' stock rows, reject a shortage, FEFO-deplete.

**Constraints:**

- No outbox exists, so writes are online-only (UE-09).
- `sales`/`sale_lines` are append-only for the app role, so undo is refused (QA-10).

## Options

1. **Keep the client's two requests and add retries.** This can't be atomic and still trusts the client's price.
2. **Atomic conditional updates** (`UPDATE stock_levels SET qty = qty − n WHERE qty >= n`). This fixes the level, but the batches and each movement's running balance are separate rows that would still race.
3. **Serializable isolation for stock transactions.** Correct, but it needs retry loops everywhere and aborts unrelated work under load.
4. **One server transaction per sale, plus one per-variant row lock** that every stock writer takes before reading. This is the sandwich pattern, generalized.

## Decision

Option 4.

**Lock rule.**

- `lockStockLevelsInTx(tx, storeId, variantIds)`:
  1. inserts a missing `stock_levels` row at 0 (`ON CONFLICT DO NOTHING`), since only an existing row can be locked;
  2. locks the rows `FOR UPDATE` in id order;
  3. returns the balances.
- Every stock writer calls it first and computes everything from the locked value. The writers are: add, waste, void, adjust, clear, archive, FEFO depletion (sales, sandwiches) and the sandwich check.
- `opId` checks run **after** the lock. Under READ COMMITTED, a concurrent retry then sees the first attempt's committed rows.
- Operations on the same variant run one after the other. Different variants never wait for each other.
- Multi-variant callers (sandwiches, promotions) lock in id order, so they cannot deadlock.

**Sale.** `recordSale` owns the whole sale in one `withTenant` transaction.

- **Steps, in order:**
  1. resolve the item in this store;
  2. lock;
  3. `opId` duplicate check;
  4. stock check, which rejects with 409 and `details.shortages`;
  5. sale + lines;
  6. FEFO depletion with `sale` movements linked to the lines.
- **Rollback:** any failure rolls back everything.
- **Response:** the sale as recorded (`id`, `totalPiasters`, `duplicate`, and `lines` with `stockAfterBase`).
- **What the server decides:**
  - The line targets only the variant.
  - The price is the variant's registered selling price × quantity (per kg × grams ÷ 1000, rounded once half up), via the pure `saleLineTotalPiasters` in `src/domain/sale-pricing.ts`.
  - The time is the server's clock.
- **Promotions:** the server reads the saved offer (`findPromotionInTx`), locks every item, and writes one line per item. Each line's total is its share of the offer price (`allocateByWeight`, exact).
- **Services (no stock):** the amount is the cashier's entry, because it varies per transaction. Classification is shared: `isServiceProduct` in `src/domain/sale-pricing.ts`.
- **Idempotency:** the client's `opId` is stored on the sale (`UNIQUE (store_id, op_id)`). A losing concurrent duplicate fails on that constraint, rolls back, and returns the winner's sale.
- **Unknown names:** goods are never created from a client name. Only a service sold by name with a machine is created, as before.

**Client.**

- The Sales screen sends ONE `POST /api/sales` (`postSale`) and waits.
- The list, stock figures and success toast change only after the server accepted the sale.
- A rejection shows the server's message; nothing changes on screen.
- No separate stock request remains.
- If a service sale is rejected after the machine was charged, the charge is refunded (the machine part is QA-03).
- Staging a service from Products no longer writes a local sale.

**Undo is removed from the Sales screen.** Recording sales for real made the old undo harmful: it would add the stock back while the database refuses to delete the sale. Undo returns with `sale.void` (QA-10).

**Overselling (decision D31):** an online sale above the stock is rejected. For online sales, this supersedes D13 ("allow and flag negative"), which stays for offline sales once a sync exists.

## Consequences

- **Positive:**
  - Every ordinary, promotion and sandwich sale is saved with its stock deduction or not at all.
  - Stock can't be oversold by concurrent devices.
  - `stock_levels = Σ batch remaining = Σ movements` holds under concurrency, and each movement's running balance chains (tested in `tests/integration/sales-concurrency.spec.ts`).
  - The server prices goods.
- **Negative / risks:**
  - A sale now waits for the server (1–5 s on the remote dev database). The screen is honest but slower, and it stays online-only until an outbox exists.
  - There is no undo until `sale.void`.
  - Locks serialize writers of the same variant. That is acceptable for a shop, but long transactions on one product queue up behind each other (timeouts: 15 s wait, 20 s run).
  - A service sale still trusts the entered amount, and the machine deduction is a separate request (QA-03).
  - Existing rows that earlier races already corrupted are not repaired (QA-05).
  - Movement `created_at` is the operation's start time, so under concurrency it may not match commit order. The running balance (`balance_after_base`) is the order of record.
- **What changed:**
  - `src/server/modules/inventory/inventory.service.ts` (the lock and every writer).
  - `src/server/modules/sales/sales.service.ts`.
  - `src/server/modules/promotions` (`findPromotionInTx`).
  - `src/server/modules/sandwiches` (uses the shared lock).
  - `src/schemas/sale.ts`, `src/domain/sale-pricing.ts`.
  - `src/client/shared/api/sales.ts`, `src/client/features/sales/SalesView.tsx`.
  - `docs/03-data.md` §5 and `docs/01-product.md` (D31, K1/K2).
- **Revisit when:**
  - The outbox is built: the sale becomes the `sale.create` operation with the same `opId`.
  - `sale.void` lands: restore undo.
  - Machines get an atomic server-side deduction (QA-03): fold the service sale and the deduction into one transaction.
