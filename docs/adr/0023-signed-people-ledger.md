# ADR-0023: Signed people balances, visible credit, labelled owner adjustments

- **Status:** Proposed
- **Date:** 2026-11-12
- **Fixes:** audit QA-12 (`docs/QA/FULL-SYSTEM-AUDIT.md`), extends UE-11

## Context

- **Floored balances:** customer, payable and supplier balances were shown as `Math.max(0, …)`, so an overpayment became a hidden credit that silently absorbed later debts.
- **Fabricated entries:** editing a person (`PATCH /api/people/:id`) always sent the displayed amount. The server wrote an ordinary debt or payment entry to force the balance to that amount. Renaming a customer with a hidden credit therefore invented a debt (9,943.99 in the audit).

## Decision

1. **Balances are signed and never floored** (`src/domain/ledger.ts`):
   - **Customers:** a positive balance means they owe the shop; a negative one means the shop owes them (credit).
   - **Payables and suppliers:** a positive balance means the shop owes them; a negative one means the shop paid ahead (they owe the shop).
2. **Overpayment is accepted and shown as a credit, not rejected.**
   - It covers advance payments to suppliers and customers' change kept on account.
   - The People screen shows the credit in words ("ليه عندك … (دفع زيادة)").
   - Section totals keep credits apart from what is owed (`total_credit_piasters`).
   - The payment form warns when an amount exceeds what is owed.
3. **`debt_entries.entry_kind` records what each entry is:** `opening`, `transaction`, or `adjustment`.
   - New people get an `opening` entry.
   - An owner edit writes one `adjustment` entry for the difference from the true balance. It is labelled "تعديل رصيد (صاحب المحل)" and excluded from the debt and payment totals.
   - Nothing is written when the balance is unchanged, and the form sends an amount only when the owner changed it.
   - The table stays append-only; history is never changed.
4. **Every ledger write locks the person's row** (`SELECT … FOR UPDATE`).
   - Concurrent writes run one after the other and report exact running balances.
   - An `opId` already used returns the existing entry; the same `opId` on another person is a 409.
   - Unknown or other-store people are a 404. Real errors are no longer swallowed and reported as 500s.

## Data

- **Migration `20261112010000_debt_entry_kind`** adds the column with default `transaction` and a check constraint on its values. It also adds `amount_piasters > 0` as `NOT VALID`, so only new rows are checked.
- **No backfill.** Balancing entries written by the old edit code cannot be reliably told apart from real ones, so they stay as they are. Each shop's ledger needs a data review (look for entries noted "تعديل رصيد"). Nothing is deleted or rewritten automatically.

## Consequences

- No hidden state: every number on the screen is the ledger's.
- The AI debt summary still lists only people who owe money; credits are not reported there.
