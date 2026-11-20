# ADR-0032: Stock Paid From a Machine, and Service Commission Rules

- **Status:** Proposed
- **Date:** 2026-11-18
- **Decision-maker:** Ahmed Tarek / Team Hesba
- **Extends:** ADR-0031 (cash drawer, `paid_from`), ADR-0020 (machine balances)

## Context

The final review of PR #40 asks for three things the API could not do:

1. When stock comes in, the payment choices must be the shop's real ones: cash (the drawer),
   **each machine / wallet the shop registered** (Fawry, Vodafone Cash, InstaPay…), or
   credit to a supplier. Paying from a machine must lower that machine's balance.
2. A service's commission can be a fixed amount **or a percentage**, optionally by **tiers
   of the operation's amount** («من 100 لحد 1000 → 5 جنيه»). Until now a service stored one
   number (its price), read as a fixed commission.
3. The sale screen's barcode scanner must not depend on the AI scanner or its quota.

## Decision

### Stock paid from a machine (no migration)

- `POST /api/stock` (`action: "add"`) and `POST /api/purchases` accept an optional
  `paidFromMachineId`. In the same transaction as the batch (or the purchase's paid-now
  part), the machine is charged through `changeMachineBalanceInTx`: the row is locked, there
  is no overdraft (a short balance is a 400 and **the whole stock-in rolls back**), and the
  ledger row's `reference` is the batch / purchase id.
- The batch / payment is recorded with `paid_from = 'wallet'`, so it never counts in the
  drawer (ADR-0031). Idempotency stays the stock-in / purchase `opId`.
- Voiding a batch does not refund the machine (the same as cash today; see open question).

### Service commission rules (no migration)

- Stored per service under `stores.settings.salesConfig.serviceCommissions`
  (`{ type: "fixed" | "percent", value, tiers: [{ fromPiasters, toPiasters, type, value }] }`),
  written through `POST /api/sales/config` (merged; `null` removes one).
- Validated on the server (`serviceCommissionRuleSchema`, `domain/service-commission.ts`): no
  overlapping tiers, the top of a tier above its bottom, no negative commission, a percentage of
  100% or less. A bad rule is a 400 and nothing is saved.
- Tiers are half-open (`from ≤ amount < to`), the top of the highest tier included; an amount
  outside every tier takes the base commission. A service without a rule keeps its price as
  a fixed commission (older services are unchanged).
- The sale screen computes the commission from the rule; the sale records the same totals as
  before (the server already took a service sale's amount from the client).

### Barcode scanner

- `BarcodeScanSheet` decodes on the device (`BarcodeDetector`); a physical scanner works while
  it is open. No AI, no quota request, no product API. The AI scanner backend and the admin
  quotas are unchanged; only the sale screen's client sheet for it was removed.

## Consequences

- No database migration in this round.
- A machine payment and its stock are one transaction: either both happen or neither.
- Open question: refund a machine / the drawer when a paid batch is voided.
- Browsers without `BarcodeDetector` (Safari / iOS today) open the camera but cannot decode;
  they get the typed fallback and a physical scanner. A decoding library would fix this.

## Additions (closing round)

- **Expenses** take `paidFromMachineId` (the machine pays, in the expense's transaction). Cancelling
  today's expense keeps the row (`deleted_at`), gives a machine its money back through its ledger
  (reference = expense id, once), and the drawer counts a cancelled cash expense back in.
- **Service commission** is slabs only (`slabsRequired`): an amount outside every slab is not sold.
- **Credit checkout** takes `newCustomer`: the customer is created inside the sale's transaction.
- **People payments** take `paidFromMachineId`: a collection raises the wallet, a supplier payment
  lowers it (no overdraft), in the entry's transaction.
- **Drawer** (ADR-0031): closing is serialized per shop (advisory lock); the same close from another
  tab (same amount, < 60 s, nothing moved) is a 409; the server returns each close's difference and
  the latest cash movements. A credit invoice's refund beyond what was owed has no recorded source
  and is reported under «unknown», never guessed.
- **Invoices** carry each line's pack, contents and returned value (additive fields), so a partial
  return is typed in the unit the product is sold in; the return value rule is shared
  (`domain/sale-return.ts`).
- **Exports**: `GET /api/reports/export` and `GET /api/stock/export` (`xlsx` | `csv`) build the file on
  the server from the same services as the screens; the `.xlsx` writer has no dependency.
