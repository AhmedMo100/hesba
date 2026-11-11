# ADR-0025: Value bounds, one money rule per field, and idempotent writes

- **Status:** Proposed
- **Date:** 2026-11-12
- **Fixes:** audit QA-15, QA-16, QA-21, QA-22, QA-23, QA-27, QA-33 (`docs/QA/FULL-SYSTEM-AUDIT.md`)

## Decisions

### QA-15: bounds (`src/domain/limits.ts`, decision D33)
- **The limits:**
  - one money amount ≤ 10,000,000 EGP (`MAX_AMOUNT_PIASTERS` = 1e9);
  - one unit price ≤ 1,000,000 EGP;
  - one operation's quantity ≤ 1,000,000 base units (a million pieces, or one tonne in grams);
  - pack size ≤ 10,000.
- **Where they apply:** every zod schema uses them: products, stock, expenses, sales (amount, commission, machine charge), promotions, machines, sandwiches and people. A value above a limit gets 400; the API never truncates it or turns it into 0.
- **Database backstop:** `CHECK … NOT VALID` constraints on expenses, debt entries, sales, sale lines, product and variant prices, and batch quantities. Historical rows are not rewritten. Values written before the bounds existed (the audit's 10¹⁵ probes on Neon dev, for example) need a data review.
- **Opening stock:** `initialQuantity` is in base units (pieces or grams), as the service always treated it. It is an integer within the bound.

### QA-16: no silent zeroing
- A stock decrease beyond the stock gets 409 (`details.availableBase` and `requestedBase`), and nothing is written. This is the same rule as sales, waste and sandwiches (D31).

### QA-21: sales-screen config
- `POST /api/sales/config` is a strict **partial** update: only the lists that are sent change.
- Unknown fields, wrong types, empty, non-object or malformed bodies get 400 and leave the saved config unchanged.
- The screen sends only `enabledServiceIds`. Under the old code that save also erased `enabledProductIds`.

### QA-22: one money rule per field
The People API had two units on one field. The repo's rule is integer piasters (AGENTS rule 5), so:
- **`amountPiasters` / `amount_piasters`:** integer piasters as a JSON number only. A string or a fraction gets 400.
- **`amountEgp`:** pounds, as a number or a string with at most 2 decimals, Arabic digits accepted (`"50"`, `"50.00"`, `50` and `"٥٠"` all mean 50.00 EGP). It is parsed exactly by `parseEgpStrict`, with no floating point.
- **Send one or the other:** sending both gets 400.
- **The expenses screen** now converts pounds with `parseEgpStrict` instead of `parseFloat × 100`.

### QA-23: same-name products
- **Duplicate names are allowed.** Names are not unique in a shop (two sizes of one product are common), and that is unchanged.
- **The 500 was a transaction bug.** `recordAdoption` caught a unique violation inside the product transaction, which Postgres then aborted (25P02). It now uses `INSERT … ON CONFLICT DO NOTHING`.
- **One copy of each global product per shop:** adding a global catalog product the shop already holds (unique `(store_id, global_product_id)`) gets a clear 409. The unique index decides between concurrent adds.

### QA-27: idempotency
Each write already has, or now gets, a client `opId` stored on the business row, with a unique `(store_id, op_id)`. The decision and the write happen in one transaction, and the unique index decides between concurrent requests:
- **Same `opId`, same payload:** returns the first result and changes nothing more.
- **Same `opId`, different payload:** 409.
- **Failed first attempt:** leaves nothing behind, so the retry is applied.
- **Another store:** `opId` values are scoped per store, so stores can't collide.

| Write | Before | Now |
|---|---|---|
| Sales (ordinary, sandwich, promotion, service), `POST /api/sales` | `opId` (QA-01/03) | + payload check (another item or quantity gets 409) |
| Sale void, `POST /api/sales/void` | `opId` (QA-10) | unchanged |
| Expenses, `POST /api/expenses` | **none** | `expenses.op_id` + unique; replay and payload check; P2002 race returns the first expense |
| People debt/payment, `POST /api/people/:id/transactions` | `opId` + person row lock (QA-12) | + payload check (another amount or direction gets 409) |
| Stock add, waste, adjust, clear | `opId` on movements | + check that it is the same variant and the same kind of movement (409) |
| Machine top-up, deduct, adjust | `opId` (QA-03) | unchanged (already checks the machine) |

**The UI sends a retry key** (`useRetryOpId`) for expenses, payments and stock adjustments. A retry of the same payload reuses its `opId`.

**Not covered yet, and why:**
- People creation, product creation, promotions and taxonomy have no operation id on their rows. Their duplicates are harmless or visible (a second person or product), and adding keys there means schema changes beyond this batch.
- Profile and sales-config are full or partial overwrites, so repeating them is harmless.
- Stock void-batch and archive already refuse a second application.
- `opId` stays **optional** for compatibility; requests without it are not deduplicated.

### QA-33: sale lines
- **Already fixed by QA-01 (#16) and verified here:** the server prices ordinary lines from the registered price (unit price = the real unit price), the totals come from those lines, and the time is the server clock; client amounts and timestamps are ignored.
- **Remaining gap closed:** a negative or unbounded `commissionPiasters` (and sale amount) is now rejected.

## Risks
- `updateStoreSettings` reads and writes the settings JSON without a row lock, so two concurrent settings writes can overwrite each other. This is pre-existing and not in this scope.
- The limits are product assumptions (D33); the owner should confirm them.
