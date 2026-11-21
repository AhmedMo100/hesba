# ADR-0031: Optional Shop Barcode and the Cash Drawer

- **Status:** Accepted
- **Date:** 2026-11-17
- **Decision-maker:** Ahmed Tarek / Team Hesba
- **Amends:** ADR-0016 (barcode)

## Context

The V17/V19 UI reference asks for three things the schema could not support:

1. A «بدون باركود» sale filter, barcode lookup when stock comes in, and a first-run «ابدأ
   بالباركود» flow. ADR-0016 removed every barcode column, so no product could have one.
2. The real amount in the cash drawer (الدرج). Nothing recorded an opening balance or a count,
   and expenses, supplier payments and customer collections did not record whether the money
   left or entered the drawer or a wallet. Treating today's sales as the drawer would be an
   invented number (AGENTS.md rule 10).

## Decision

### Barcode (amends ADR-0016)

- `store_variants.barcode TEXT NULL`: optional, this shop only, unique per shop when set
  (partial unique index). Never mandatory, never a catalog key, never sent to the shared
  catalog or to any external product API. The rest of ADR-0016 stands.

### Cash drawer

- `cash_drawer_counts` (tenant RLS, append-only for the app): the owner's counts.
- `paid_from TEXT NULL` (`cash` | `wallet`) on `expenses`, `debt_entries` (payments) and
  `store_stock_batches` (what paid a received batch). `NULL` = not recorded: older rows.
- Expected drawer = last count + cash in − cash out after it:
  - in: cash sales not voided; customer payments paid in cash;
  - out: refunds of cash sales' returns; voids (after the count) of cash sales made before it;
    expenses, supplier/payable payments and stock batches paid from cash; machine top-ups whose
    source is the drawer.
- Movements with no `paid_from` are listed apart and never counted. Before the first count
  there is no expected amount: the screen asks for a count instead of showing a number.

## Consequences

- Additive migration only; existing rows keep their meaning.
- New writes record `paid_from` where the screen asks for it (expense, payment, stock in).
