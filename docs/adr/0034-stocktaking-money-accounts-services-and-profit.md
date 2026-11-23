# ADR-0034: Physical stocktaking, «فلوس حِسبة», services with commissions, and the profit account

- **Status:** Accepted
- **Date:** 2026-11-23
- **Related:** ADR-0021 (ledger truth, batch cost), ADR-0023 (signed people ledger), ADR-0029
  (losses), ADR-0031 (drawer), ADR-0032 (commission rules), ADR-0033 (operating modes)

## Context

The owner of a small shop in إدارة المحل mode records the day's sales as one total, not every
receipt. He still has to be able to answer four questions:

- «المخزون ناقص ليه؟» (why is stock missing?)
- «فلوسي فين؟» (where is my money?)
- «كسبت كام من الخدمات؟» (what did I earn from services?)
- «أنا كسبت كام؟» (what did I earn overall?)

The answers must never turn a guess into a fact. Each feature below extends an existing ledger;
no parallel stock or money system is introduced.

## Decision

### 1. Stocktaking (`inventory_counts`, `inventory_count_lines`)

- **Scope:** the whole shop, one category, or chosen products. Only one count can be open per
  shop (partial unique index). Starting and confirming are both idempotent: `op_id` and
  `confirm_op_id`.
- **Difference** = counted − expected. The expected quantity is snapshotted each time a line is
  counted, so sales made while counting are not mistaken for differences. At confirmation, the
  difference is applied relative to the current stock.
- **A shortage is never a sale on its own.** The owner chooses the reason:

  | Reason | What it does |
  | --- | --- |
  | `unrecorded_sale` («اتباع ومتسجلش») | Stock goes out at its FEFO cost. Its value at the selling price is fixed at confirmation (`applied_sale_minor`). It is reported as a sale *discovered by the count*, with no payment method, no customer and no money movement. |
  | `damaged` | Recorded in `waste_records` (the existing loss ledger), so it is counted once. |
  | `lost` | Recorded in `waste_records` as `missing`, counted once. |
  | `unknown` (default) | Stock goes out and the cost is reported as an unexplained shortage — a loss, not a sale. |

- **A surplus** goes back into stock as a batch at the known cost, with prefix `CNT-`. It is not
  a purchase and moves no money.
- **An abandoned count** changes nothing. **A closed count** is frozen by database triggers.
- Moving stock from the store room to a shelf is not recorded anywhere.
- The tables are named `inventory_counts`: an abandoned, never-merged branch left unused
  `stocktake_*` tables in some development databases. Nothing drops them, and the drift test
  allows exactly them, by name.

### 2. «فلوس حِسبة» (`money_movements`)

- Balances come from the existing sources: the drawer's expected cash (ADR-0031) and the
  machines / wallets (`pos_machines` + `pos_machine_topups`).
- The new table holds only what had no home before:
  - owner withdrawals;
  - owner deposits;
  - transfers between the drawer and wallets, or between two wallets.
- The machine side goes through `changeMachineBalanceInTx`: row lock, no overdraft, rollback
  on failure.
- The drawer reads the cash side in one query (`extraCashTotalsSince`).
- A transfer is never income or an expense. An owner withdrawal is never an operating expense.
  For the same reason, the expense category «مصاريف شخصية» is shown as a withdrawal in the
  profit account.
- Records are append-only: a mistake is corrected by the opposite movement.

### 3. Services (`service_transactions`, both modes)

- **Catalog:** `src/domain/services-catalog.ts` covers wallets, Fawry / Aman, mobile recharge,
  internet, utilities and cards.
- **No provider integration exists.** The owner records an operation after performing it on
  the provider's app or machine, and nothing claims a provider confirmation.
- **Money**, with `a` = the operation's value and `c` = the commission:

  | Direction | `customer_fee` | `provider_discount` |
  | --- | --- | --- |
  | send | customer pays a + c; float −a | customer pays a; float −(a − c) |
  | receive | float +a; customer gets a − c | float +(a + c); customer gets a |

- In every case `in − out = c`, and a database CHECK enforces it. **Only `c` is income**; `a`
  is never revenue.
- **Commission:**
  - It comes from the shop's rule (`stores.settings.serviceRules`, using the existing slab
    engine of ADR-0032), or the owner types it.
  - It is stored on the transaction, so later rule changes never rewrite history.
- Cancelling reverses Hesba's books (float, wallet, drawer) exactly once. It does not claim the
  provider reversed anything.

### 4. The daily total: credit and quantities

- **Credit (آجل) to named customers:**
  - It is part of the total (revenue) and creates one «ليك» debt per customer, linked by
    `debt_entries.daily_sales_entry_id`.
  - A later collection settles the debt and is never a second sale.
- **Optional quantities** (`daily_sales_entry_items`) take stock out at their FEFO cost but add
  no revenue: the money is already in the total.
- **Cancelling a total:**
  - The debts are reversed with `reversal` entries, so collections already made stay.
  - The quantities go back to stock (`DSR-` batches).

### 5. The profit account (`HomeReport.profit`)

Net profit = gross profit + service commissions − operating expenses − inventory losses.

- **`actual`:** every product sale in the period has a recorded cost.
- **`estimated`:** daily totals have no cost per item. Their gross profit is valued at the
  margin of the shop's own current stock (selling value vs cost value), and the notes say so.
- **`incomplete`:** there is no basis for an estimate, or there are invoices without a cost.
- **Never counted in profit:**
  - collections;
  - supplier payments;
  - transfers;
  - owner withdrawals and deposits;
  - a service's operation value.
- **Losses:** damaged and lost goods are counted once, from `waste_records`. Unknown stocktake
  shortages are counted from the count lines.
- **Inventory value:** FEFO batches at cost, and stock levels at selling price (the same rule as
  `stockValuePiasters`).
- **Round trips:** all profit inputs are read in one query and inventory value in one more,
  which takes the Home report from 23 to 25 round trips.
- **AI assistant:** it reads the same numbers through `periodProfitInTx`, using its three new
  read-only tools (money accounts, services, stocktake). No second assistant was added, and its
  quotas and privacy are unchanged.

### 6. Offline

The new operations are **online only and not queued**:
- stocktake counts and confirmation;
- money movements;
- services;
- the daily total's credit and quantities.

A money or stock operation is never shown as recorded before the server confirmed it. Each one
is idempotent by `opId`: the screen keeps the same id until success, so a retry is recorded
once. When the device is offline, the screen says the operation was not recorded.

## Consequences

- One migration (`20261123000000_stocktake_money_services`): new tables under FORCE RLS with
  append-only grants. No existing data is rewritten.
- New routes:
  - `/api/inventory-counts` (and `/:id`, `/:id/confirm`, `/:id/abandon`)
  - `/api/money`, `/api/money/movements`
  - `/api/services`, `/api/services/transactions` (and `/:id/cancel`), `/api/services/rules`
- Owner-only actions: confirming a count, money movements, cancelling a service, editing
  commission rules.
- Tests: `tests/integration/simple-mode-financials.spec.ts` covers stocktaking, money, services,
  daily credit and profit.
