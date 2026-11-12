# ADR-0027: Supplier purchases, invoices (cart, credit, discount, returns), and request cost

- **Status:** Proposed
- **Date:** 2026-11-12
- **Fixes:** audit QA-30, QA-31, QA-32 (`docs/QA/FULL-SYSTEM-AUDIT.md`), plus a performance pass
- **Business rules:** the owner's rules of 2026-11-12, recorded as D35 in `docs/01-product.md`

## Context
- **QA-30:** the `purchases` and `purchase_lines` tables existed but nothing wrote them, so supplier balances were typed in by hand.
- **QA-31:** the Sales screen sold one item per tap, always as cash, with no discount and no way to return an item.
- **QA-32:** the Neon dev database looked slow.

## Decisions

### No second ledger, no second stock path
- **Money:** everything goes through the people ledger (`debt_entries`, ADR-0023). Invoice entries are linked by the new `purchase_id` / `sale_id`, using composite same-store foreign keys.
- **Stock:** everything goes through batches and append-only movements under the stock lock (ADR-0019/0021). The new movement types are `sale_return`, plus `purchase` / `purchase_void` with a purchase.
- **Append-only:** append-only tables stay append-only for `hesba_app`. A cancelled purchase is a new `purchase_voids` row and a return a new `sale_returns` row (+ lines), like `sale_voids` (ADR-0022). All have FORCE RLS.
- **New ledger kind:** `reversal` takes back an invoice's debt (a cancelled purchase, a voided or returned credit sale). It lowers the debt total and is never counted as a payment.

### QA-30: purchases (`/api/purchases`)
- **Creating a purchase** is one transaction:
  - the supplier is locked, then the opId is checked;
  - one batch and one `purchase` movement are written per line;
  - the invoice debt is the **server's** sum of the line costs;
  - an optional payment made now is linked to the invoice.
- **Payments** (`/payments`) are linked to the invoice and its debt entry, and cannot exceed what it still owes.
- **Cancelling** (`/void`):
  - it is refused (409) when any of the invoice's stock was sold, wasted or adjusted;
  - otherwise the batches are emptied with `purchase_void` movements and the whole debt is reversed;
  - payments already made stay, so the supplier then owes them back as a visible credit.
- **Idempotency:** everything is idempotent by opId. A reused opId with another payload gets 409.

### QA-31: invoices (`/api/sales/checkout`, `/api/sales/:id`, `/payments`, `/returns`)
- **Cart:** a cart of stocked products is sold as one sale. Sandwiches, offers and services keep their own one-tap sale.
  - every line is priced from the registered price, and the client sends no price and no total;
  - stock is checked and taken FEFO under the lock.
- **Discount:**
  - an invoice discount must be below the subtotal, so the total is always > 0;
  - it is split over the lines in proportion to their value (largest remainder);
  - each line keeps its real unit price, its discount share and its total after the discount;
  - `sales.discount_piasters` and `sale_lines.discount_piasters` are new columns.
- **Payment method:** cash, wallet, card or debt, validated by the server and stored on the sale. Single sales accept cash, wallet or card too.
- **Credit sale (debt):**
  - a customer is required, and the receivable is written in the same transaction;
  - a payment now is optional;
  - later payments are linked to the invoice and bounded by what it still owes;
  - revenue is the invoice, at invoice time.
- **Returns:**
  - a return references the sale and its lines;
  - a quantity is at most what was sold minus earlier returns;
  - the value is the original line total, pro rata (`floor(total × n / sold)` cumulatively), so a full return gives back exactly the line total;
  - stock goes back to the batches the sale took from;
  - on a credit sale the value first lowers what is still owed (a `reversal`), and the rest is refunded;
  - returns are serialized per sale (advisory lock) and idempotent by opId.
- **Void rules:** a sale with a return can't be voided; return the rest instead. Voiding a credit sale reverses its receivable.
- **Readers:**
  - the sales list's today total is net of returns;
  - the Home report counts a sale net of its returns (revenue and the returned share of cost), on the sale's date.

### QA-32: request cost on Neon
- **Measured (2026-11-11, from Egypt to Neon eu-central-1):**
  - one round trip: 63 ms (median);
  - a new connection: ~650 ms;
  - each request opens a tenant transaction (BEGIN, `set_config`, …, COMMIT).
- **What latency depends on:**
  - endpoint latency is about round trips × 63 ms;
  - there is no N+1: the counts do not grow with the number of products;
  - the cost is the number of round trips per request, and requests made twice by the screens.
- **Application changes:**
  - `withTenant` sets the store and the user in one statement (−1 round trip per transaction);
  - the session's `last_seen_at` is written at most every 5 minutes instead of on every request (−1);
  - `/api/stock?view=all` reads inventory and movements in parallel;
  - Sales, Home and Purchases call `/api/stock` (inventory only) instead of also loading 100 movements;
  - indexes for the hot paths (`20261116000000`, see the table below).
- **Indexes added:**

  | Index | Serves |
  |---|---|
  | `sale_lines.sale_id` | every sale-lines include |
  | `sales (store_id, created_at)` | sales list, report periods |
  | `store_variants.store_product_id`, `store_variants.store_id` | product/stock/alert includes |
  | `stock_movements (store_id, created_at)`, `.sale_line_id`, `(store_id, op_id)` | history, void/return restore, replays |

- **Round trips before → after:**

  | Request | Before | After |
  |---|---|---|
  | session | 8 | 6 |
  | simple reads | 13 | 10 |
  | sales | 18 | 15 |
  | home | 24 | 21 |

  `tests/integration/query-budget.spec.ts` pins these budgets. At 63 ms per round trip, that is ≈ 190 ms less per request on Neon (an estimate from the measured round trip).
- **Infrastructure (not changed, needs authorization):**
  - Neon region: eu-central-1 is ~63 ms from Egypt; nothing closer is offered;
  - the cold start of a suspended compute, which costs the ~650 ms first connection;
  - for serverless hosting, Prisma's `connection_limit=1` and `pgbouncer=true` on the pooler URL.

### Performance pass: requests and caching
- **Duplicate requests (measured on a production build):**

  | Screen | Requests before → after |
  |---|---|
  | Sales | 16 → 9 |
  | Alerts | 8 → 5 |
  | Products | 6 → 5 |
  | Stock | 6 → 5 |
  | Home | 4 → 4 |
  | People | 3 → 3 |

  There are no duplicates and no requests while idle (`tests/e2e/screen-requests.spec.ts`).
- **Causes of the duplicates:**
  - load effects ran once without the shop and again with it (now they wait for the signed-in shop);
  - the shell's alerts badge and the Alerts screen fetched at the same time.
- **Caching strategy, in-flight deduplication only (`dedupedGet`):**
  - identical GETs in flight share one request;
  - nothing is kept after the answer, so no business data is ever served stale;
  - it is cleared on sign-in and sign-out;
  - it is used for alerts, promotions and machines.
- **Deliberately not cached (always the server's latest answer):** stock, sales, purchases, invoices, payments, balances, expenses and the session.
- **Loading states:**
  - a shared `Skeleton` (shown only after 150 ms, so fast answers don't flicker; respects reduced motion);
  - on Sales tiles: placeholders instead of a false "no products" while loading;
  - on Home KPIs: a placeholder while loading; "—" still means unknown;
  - in the invoice and purchase sheets;
  - action buttons use the existing `Button loading`, which disables, shows a spinner and keeps its size.
- **Images and assets:**
  - there are no product images in V1 (out of scope);
  - the logo already uses `next/image` with fixed size and priority;
  - the fonts are self-hosted woff2 subsets (~9 KB each) with `font-display: swap`;
  - nothing needed changing.

## Consequences
- The supplier and customer balances now follow real invoices. Manual entries still work.
- **Risks:**
  - weighed items in the cart start at 1 kg, adjustable in 250 g steps;
  - sandwich and service lines cannot be returned (400, "مينفعش يترجع من هنا"); offer lines can;
  - the index migration is applied locally only; on Neon dev it needs approval.
