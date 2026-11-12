# ADR-0029: Expired stock, damaged / lost goods, and damaged returns

- Status: Accepted
- Date: 2026-11-12
- Related: ADR-0019 (stock lock), ADR-0021 (batch cost), ADR-0022 (void), ADR-0027 (returns)

## Context

Stock already lives in batches (`store_stock_batches`): each delivery is its own batch with its
own expiry, quantities are integer base units, sales take FEFO and record one movement per batch
part, and returns/voids put goods back into the batches the sale took from. Three gaps remained:
sales could take **expired** batches, losses had a free-text reason and no place on Home, and a
returned item could only go back on sale.

## Decision

1. **Expired goods are not sellable.** A batch is expired when its expiry date is before today
   on the Cairo calendar (it still sells on its expiry day). Every sale path (single sale,
   offer, cart checkout, sandwich) checks availability against *sellable* stock = ledger balance
   − remainders of expired batches (`lockSellableStockInTx`), and FEFO for `type: "sale"` only
   considers non-expired batches. Expired goods stay in stock, visible and flagged in Alerts,
   until recorded as waste — nothing is deleted.
2. **Damaged / lost goods** are `waste_records` with a reason — `expired`, `damaged`,
   `missing`, `damaged_return`, `other` — an optional note, and (for returns) the return they
   came from. Recording one takes the quantity from the chosen batch (or FEFO, expired batches
   included), appends `waste` movements, and stores the cost of what was taken from the batches'
   recorded totals. Home shows the period's losses (count, cost, by reason, recent records);
   records whose batch cost is unknown are counted apart, never estimated. Quantities are listed
   per record in their own unit (grams and pieces are not added together).
3. **Free quantity editing leaves the Stock screen.** The owner adds goods, records a loss with
   a reason, or archives a product. The controlled correction (`action: "adjust"`, which
   requires a mode and records an `adjustment` movement with its reason) stays in the API for
   reconciliation; no movement or record is ever deleted.
4. **Returns** stay tied to the invoice (`sale_returns`, `sale_return_lines`). Each line is
   `sellable` (back to stock) or `damaged`. Goods go back into the sale's own batches — the one
   with the latest expiry first, never beyond what was taken from each — so a returned item keeps
   its real expiry date. A damaged line is put back the same way and immediately recorded as a
   `damaged_return` loss from those batches: sellable stock does not grow, the customer is still
   credited / refunded once (the invoice's returnable quantity and `opId` replay rules are
   unchanged).

## Consequences

- A sale queued offline that reaches the server after its batch expired is refused (the outbox
  marks it for review), the same way as any shortage.
- Cost of goods sold is unchanged by a return of damaged goods; the loss carries their cost.
- Migration `20261118000000_waste_reasons_and_return_link` is additive (new nullable columns,
  `NOT VALID` checks so older free-text reasons stay readable, an index).
