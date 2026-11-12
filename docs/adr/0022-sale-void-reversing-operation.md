# ADR-0022: Undo a sale with a reversing void; the server is the only source of recorded sales

- **Status:** Proposed
- **Date:** 2026-11-12
- **Fixes:** audit QA-09, QA-10 (`docs/QA/FULL-SYSTEM-AUDIT.md`); K3
- **Builds on:** ADR-0019 (atomic sale), ADR-0020 (outbox), ADR-0021 (ledger truth)

## Context

- **QA-10:** Undo called `DELETE /api/sales?id=…`, which hard-deleted the sale. `sales` is append-only for the app role, so the delete always failed with a 500. AGENTS rule 6 says undo must be a reversing operation that uses the recorded takes.
- **QA-09:** The Sales screen read its list and today's total from `localStorage` (`hesba_sales_records_*`). The server's list replaced that copy only when it returned at least one sale, so a sale the server had rejected was counted as sold.

## Decision

1. **A void is a new, immutable row.** It lives in `sale_voids` (`store_id`, `sale_id`, `op_id`, `reason`, `voided_by`, `created_at`).
   - **Append-only:** the app role gets SELECT and INSERT only.
   - **One void per sale:** unique on `(store_id, sale_id)`.
   - **One void per client op:** unique on `(store_id, op_id)`.
   - **Same store only:** a composite FK `(store_id, sale_id) → sales(store_id, id)`.
   - **RLS:** enabled and forced, with the same tenant policy as other tables.
   - **`sales` itself is unchanged:** no UPDATE grant is added. The doc's planned `sales.voided_at` would have required one, so the void lives in a separate table.
2. **`POST /api/sales/void {saleId, opId?, reason?}` runs in one tenant transaction:**
   1. find the sale in this store (otherwise 404);
   2. insert the void. A concurrent second void blocks on the unique index, then fails and rolls back entirely; it is answered with `alreadyVoided: true`;
   3. restore stock with `restoreSaleTakesInTx`: for every recorded `type: "sale"` movement of the sale's lines, put the same quantity back into the same batch and append a `type: "sale_void"` movement, then write the ledger balance to `stock_levels`. Current prices, batches and stock play no part. A line already restored is refused, and a restore that would exceed a batch's received quantity is refused (409);
   4. refund a POS-machine charge of a service sale through the machine ledger, in the same transaction.
   - A sale that is already void returns `alreadyVoided: true` and changes nothing.
   - `DELETE /api/sales` no longer exists.
3. **Readers leave voided sales out of revenue:** `GET /api/sales` (still listed, flagged `voided`), the Home report, and the AI tools.
4. **The Sales screen reads recorded sales only from `GET /api/sales`:**
   - It re-reads the list after every recorded sale or void.
   - The old local copy is removed, not read.
   - While the list is loading or unreachable, the total shows "—".
   - Unsent sales stay in the outbox section, labelled as not counted.
   - "تراجع" (undo) in the success toast calls the void. Stock on screen changes only from the server's answer.

## Consequences

- **Positive:**
  - Undo works, is auditable, is idempotent, and cannot restore stock twice.
  - The cashier's total equals the server's.
- **Risks:**
  - Voiding a service sale whose machine was deleted fails (409/404) instead of losing the refund.
  - Sold units go back to their original batch even when that batch was later voided as a purchase.
  - Undo needs a network connection; there is no queued void yet (QA-17 territory).
