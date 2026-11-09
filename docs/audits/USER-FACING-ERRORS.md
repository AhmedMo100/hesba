# User-Facing Errors Audit

- **Audience:** owner and developers.
- **Date:** 2026-11-08.
- **Branch:** `refactor/production-architecture`, uncommitted.
- **Evidence types:**
  - **[T]** reproduced by an automated test.
  - **[DB]** observed in the local database.
  - **[M]** measured with a script.
  - **[C]** confirmed by reading the code path end to end.
  - **[R]** risk inferred from code, not reproduced.
- **Severity:**
  - **P0** — data loss, financial inconsistency, tenant exposure, or a core workflow unusable.
  - **P1** — major workflow fails or misleads.
  - **P2** — partial or unreliable.
  - **P3** — minor.

No fixes were made. Fix order is in `BUG-FIX-ROADMAP.md`.

---

## 1. Feature status

| Area | Status |
|---|---|
| Signup, login, logout, password recovery | Implemented and working ([T] `auth-password-session`, e2e `auth-screens`) |
| Profile editing | **Implemented but broken** (UE-04) |
| Dashboard (Home) | Implemented; shows wrong sales figures (UE-05) |
| Products, catalog, hide/unhide, custom taxonomy | Implemented and working ([T] `products-api`, `store-settings-api`) |
| Barcodes / QR / product images | Not implemented (barcodes removed by ADR-0016) |
| Stock: add, waste, void, adjust, clear, archive, history | Implemented; concurrency and clamp issues (UE-07, UE-08) |
| **Normal sale** | **Implemented but broken** (UE-01, UE-02) |
| Undo sale | **Implemented but broken** (UE-03) |
| Credit sale, customer selection at sale, multi-item cart, discounts, payment methods, invoices, returns/refunds | **Not implemented.** Every sale is a single cash line. |
| Customers / payables / suppliers ledgers, collections, payments | Implemented and working ([T] `people-api`); display issues (UE-11) |
| Expenses | Implemented and working ([T] `expenses-api`) |
| Promotions (publish/edit/delete, sell bundle) | Implemented; selling a promotion inherits the sale bugs |
| Alerts | Implemented ([T] unit) |
| POS machines and balances | Implemented; silent local fallback (UE-06) |
| Prepaid card stock (`CardSerial`), e-wallets (`Wallet`), commissions | **Not implemented.** Schema and tested domain functions exist, but no application flow. |
| AI assistant (quota, history, tools, web search) | Implemented and working ([T] `ai-backend`) |
| Offline: app shell + lazy screens | Implemented (e2e mobile passes) |
| Offline: data, outbox, sync, conflict handling | **Documented but not implemented** (UE-09) |
| Offline catalog search | Partially implemented: search exists, but the catalog is never downloaded (UE-15) |

---

## 2. Issues (most serious first)

### UE-01 · P0 · Sales are never saved on the server, but stock is still deducted (K1 + K2)

- **Where:** Sales screen (البيع), any normal product sale.
- **Trigger:** tap a product tile and sell. This happens whenever the product has a variant, which every product created by the app does.
- **What the user sees:** a success toast "تم تسجيل بيع …" and the sale in today's list.
- **What actually happens:** two independent background requests ([C] `SalesView.tsx` ~L591–678):
  1. `POST /api/stock` (adjust, delta −qty) **succeeds**, so server stock goes down.
  2. `POST /api/sales` **fails with 500**. The line sets both `store_variant_id` and `store_product_id`, which violates the check `chk_sale_lines_exactly_one_target`. The client only writes `console.warn`.
- **Evidence:**
  - [T] `tests/integration/sales-api.spec.ts`: 4 `it.fails`.
  - [DB] the local dev database contains **0** rows in `sale_lines`.
- **Impact:**
  - Data loss: revenue is never recorded on the server.
  - Inventory and financial inconsistency: stock decreases with no matching sale.
- **Workaround:** none.
- **Should:** a sale and its stock deduction are recorded atomically, and the UI reports failure.
- **Fix:** set exactly one target on the line, record the sale and FEFO deduction in one server transaction, and remove the separate client deduction (see Roadmap phase 1).

### UE-02 · P0 · Today's sales exist only in one browser's storage

- **Where:** Sales screen list and today's total.
- **What happens:** the list is kept in `localStorage`. On load it is replaced by the server list only when the server returns at least one sale ([C] `SalesView.tsx` ~L390–399).
- **Consequences** (because of UE-01):
  - Sales are visible only on the phone that recorded them.
  - They're lost when browser data is cleared or the phone changes.
  - They can vanish once the server returns any sale.
- **Impact:** data loss, wrong daily totals.
- **Fix:** follows from UE-01. Treat the server (later, the outbox) as the source of truth and show unsynced items explicitly.

### UE-03 · P1 · Undo sale always fails on the server; stock is still restored (K3)

- **Where:** "تراجع" (Undo) in the sale toast.
- **What happens:**
  - The client restores stock with `+qty` (succeeds) and removes the sale from the local list.
  - `DELETE /api/sales` returns 500 because the app role has no DELETE grant on `sales`, which is append-only.
  - Errors are swallowed.
- **Evidence:** [T] `sales-api.spec.ts` "DELETE (undo) is refused…". [C] `SalesView.tsx` ~L722–867.
- **Impact:**
  - Today: masked, because the sale was never saved (UE-01).
  - **If UE-01 is fixed alone:** an undone sale stays recorded while its stock is added back, so revenue is overstated.
  - When a sale was clamped (UE-08), undo adds back more stock than was deducted.
- **Fix:** a reversing `sale.void` using the recorded FEFO takes, in one transaction. Must ship together with the UE-01 fix.

### UE-04 · P1 · Saving the owner/store profile always fails (K4)

- **Where:** Profile modal → Save.
- **What the user sees:** the modal shows the server's generic 500 error message (`setServerError` in `ProfileModal.tsx`), and nothing is saved. The modal sends the phone with Arabic digits converted but without the `+20` prefix (`01…`).
- **Cause:** `PUT /api/auth/profile` updates `stores` outside `withTenant`. FORCE RLS hides the row (P2025), so the whole transaction rolls back, including the user's name/phone/email change.
- **Evidence:** [T] `tests/integration/profile-api.spec.ts` (`it.fails`).
- **Latent follow-on (must be fixed together):** the route writes `phone` exactly as typed (`01…` passes the schema), while login looks up the normalized `+20…` form. **Fixing only the RLS issue would let an owner save a phone in the wrong form and then be unable to log in.** Duplicate phone or email would also return 500, not 409.
- **Fix:** run the update in `withTenant`, normalize the phone with `normalizePhone`, and map unique violations to 409.

### UE-05 · P1 · Dashboard contradicts the sales screen

- **Where:** Home.
- **What happens:** Home reads sales only from `GET /api/sales`, which is empty because of UE-01. The sales screen reads `localStorage`. Home shows 0 sales or profit while the sales screen lists sales ([C] `HomeView.tsx`).
- **Impact:** wrong figures for decisions.
- **Fix:** follows from UE-01.

### UE-06 · P1 · Machine balance changes "succeed" locally when the server rejected them

- **Where:** POS machine top-up, set balance, deduct (Stock, Products, Alerts and Sales screens).
- **What happens:** `shared/api/machines.ts` falls back to a local-only change on any failure — a network error, 400 validation, 401 expired session, or 500. The UI shows the new balance; the next server load overwrites it ([C]).
- **Also:**
  - The server balance is a stored column updated read-then-write with no lock or idempotency key, so concurrent or retried operations can lose or double-count ([C] `machines.service.ts`).
  - Undo's machine refund failure is only logged to the console.
- **Impact:** wrong financial balances; a misleading success.
- **Fix:** surface failures. Queue only true offline cases (with the outbox). Lock or atomically increment on the server and add an `opId`.

### UE-07 · P1 · Concurrent stock operations can lose updates

- **Where:** any two devices or tabs changing the same item at once (sell, add stock, adjust).
- **Cause:** inventory methods read `remaining_quantity` and `stock_levels`, then write computed values, under READ COMMITTED with no row lock or atomic increment ([C] `inventory.service.ts`).
- **Impact:** stock overstated or understated. Evidence type [R]: not reproduced, but the code path is clear.
- **Fix:** `SELECT … FOR UPDATE` on the batches and level row, or atomic `increment`.

### UE-08 · P2 · Overselling silently zeros stock (K5)

- **Where:** selling or adjusting more than the recorded stock.
- **What happens:** delta adjust floors the balance at 0 and records a smaller delta, with no warning. The sale uses this path (UE-01), so history logs sales as "adjustment" movements, not FEFO "sale" movements.
- **Evidence:** [T] `inventory-stock.spec.ts` expects rejection and fails (this predates the restructuring). The code comment states the clamp is intentional.
- **Decision needed:** clamp or reject. AGENTS.md D13/O9 says "allow and flag negative".

### UE-09 · P1 · "Offline-first" is not implemented; the sync bar says "synced"

- **Where:** whole app, offline or with a flaky network.
- **What happens:**
  - The shell and screens load offline, but every screen fetches its data, so offline lists are empty or stale.
  - Writes are fire-and-forget or fail.
  - There is no outbox, no sync, no retry, no conflict handling.
  - The sync bar shows "synced" whenever the browser is online, and the pending count is never computed ([C] `AppShell.tsx`, `SyncBar.tsx`).
- **Misleading message:** when the database is unreachable, the API returns "جاري إعادة المحاولة... شغلك محفوظ" ("retrying… your work is saved"). Neither is true ([C] `platform/error.ts`).
- **Impact:** data loss during outages; false reassurance.
- **Fix:** sync engine (separate ADR); until then, honest status and messages.

### UE-10 · P2 · Login timing reveals which phones have accounts

- **Trigger:** log in with a phone that doesn't exist.
- **What happens:** the "dummy" Argon2 hash used for timing protection is malformed. It fails in ~0.05 ms, versus ~10 ms for a real verify.
- **Evidence:** [M] node script against `@node-rs/argon2`.
- **Impact:** security/privacy (account enumeration).
- **Fix:** generate a real hash at startup with the same parameters.

### UE-11 · P2 · People balances hide overpayments; errors show as generic failures

- **Overpayment:** a payment larger than the balance is accepted, but balances display as `max(0, …)`, so store credit owed to a customer is invisible ([C]).
- **Missing records:** a missing customer, supplier or payable throws a plain `Error`, which surfaces as 500 rather than 404.
- **No idempotency on retry:** `PeopleView` sends no `opId`, so a retry after a timeout records twice. Buttons are disabled during submit, which stops double-clicks.

### UE-12 · P2 · Signup can leave an unusable account

- **Cause:** the user row is created first; the store, membership and device are created in a separate transaction.
- **Consequence:** if the second step fails, login returns 500 ("no store") and re-signup says the phone is already registered ([C] `signup.service.ts`). Rare.

### UE-13 · P2 · Alerts: odd offers and day boundary

- **Price above original (K7):** a clearance offer for an item under ~0.67 EGP is raised to the 0.50 EGP floor — above its price, with negative savings. [T] `tests/unit/domain/alerts.spec.ts`.
- **Wrong day (K8):** expiry days use the server's local day, not Cairo, so they can be off by one around midnight on a UTC server. [C]
- **Weighed items never "low":** "low stock" means ≤ 5 base units, which for weighed goods is 5 grams. [C] `inventory.service.ts`.

### UE-14 · P3 · On-screen stock changes every variant of a product

- **Where:** Sales screen local stock after a sale or undo.
- **What happens:** the local update matches by `productId`, so all variants of a product change ([C]). Corrected on the next reload.

### UE-15 · P3 · Offline catalog suggestions are always empty

- **Cause:** `ProductFormModal` searches the local catalog, but `syncCatalog` is never called, so the local catalog is empty. Each search also opens a new IndexedDB connection ([C]).

### UE-16 · P3 · Desktop: two "Alerts" buttons with the same label

- **What happens:** the Header bell and the SideNav item share `aria-label="التنبيهات"`. Screen readers announce two identical targets, and the desktop e2e test fails on it.

### UE-17 · P3 · Sessions end after 30 days even for active users

- **Cause:** sessions never slide. The client never calls `/api/auth/rotate`.
- **Membership:** a removed store member keeps access until expiry, because membership isn't re-checked per request.

### UE-18 · P3 · Login rate-limit returns 400 (password recovery returns 429)

Inconsistent error handling for clients.

### UE-19 · P2 · Batch cost is stored as a total but read as a per-unit cost

*Logged 2026-11-09 while building sandwiches (ADR-0018). Not fixed.*

- **What happens:** the Add-Stock screen sends the batch's **total** purchase cost as `costPricePiasters`, and `addStockBatch` stores it in `store_stock_batches.cost_price_minor`. Several other parts of the code read that same column as a **per-unit** cost:
  - FEFO allocations (`stock-engine`, the `cost_price_minor` on sale movements);
  - the initial-stock path in `upsertStoreProduct` (`cost_total_minor = cost × qty`);
  - `getStoreProducts`, which shows the latest batch's value as the product's "buy cost";
  - HomeView and StockView valuations.
- **Impact:** inventory valuation, the displayed buy cost after a stock intake, and movement costs can be off by a factor of the batch quantity.
- **Workaround in place:** sandwich costs use the registered purchase price (`buy_price_piasters`), not batch costs.
- **Fix (owner decision):** store a per-unit cost (total ÷ quantity) plus `cost_total_minor` in `addStockBatch`, and backfill existing batches.

### UE-20 · P2 · The sales screen requests `/api/machines` in an endless loop

*Logged 2026-11-09 while verifying sandwiches on the dev server. Present at HEAD (before ADR-0017 and ADR-0018). Not fixed.*

- **Cause:**
  - `fetchStoreMachines` (`src/client/shared/api/machines.ts`) saves the result with `saveStoredMachines`, which dispatches `hesba_machines_updated`.
  - `SalesView` listens for that event and calls `fetchStoreMachines` again, so the cycle never ends.
- **Seen:** 81 `GET /api/machines` requests within about two minutes of one open sales screen. The page never reaches network idle.
- **Impact:** constant load on the server and database (each request is a tenant transaction), plus battery and data use on phones.
- **Fix:** do not dispatch the event from the fetch path, or ignore the event when it was caused by our own fetch.
- **Status (2026-11-09):** fixed on the **Sales** screen only. The loop there kept the screen's own data requests waiting, which the sandwich "إضافة إلى البيع" step depends on. The `hesba_machines_updated` listener in `SalesView` now reads the cache (`getStoredMachines`) instead of fetching again. `AlertsView` (`loadMachines`) still has the same loop and is **not fixed**.

---

## 3. Previously logged defects K1–K10

| ID | Classification | Evidence |
|---|---|---|
| K1 sale line constraint | **Confirmed** | [T] 4 `it.fails`; [DB] 0 `sale_lines` |
| K2 no stock movement / server `opId` | **Confirmed** | [C] `sales.service.ts`; the sales screen deducts via a separate adjust |
| K3 undo fails | **Confirmed** | [T] `sales-api.spec.ts`; permission denied for table `sales` |
| K4 profile save fails | **Confirmed**, plus a latent phone-normalization trap | [T] `profile-api.spec.ts` |
| K5 clamp vs test | **Confirmed** (code and test disagree; pre-existing) | [T] fails at baseline and now |
| K6 UUID v7 regex | **Not reproducible with current data** — all DB ids are v4 (`gen_random_uuid()`). Latent only. | [M] regex: v4 true, v7 false; schema defaults |
| K7 offer above original | **Confirmed** (P3) | [T] unit |
| K8 non-Cairo day | **Confirmed by code** | [C] |
| K9 AI env names | **Confirmed**: `.env.example` defines `HESBA_LLM_*`; code reads `GEMINI_*`/`BRAVE_*` | [C] |
| K10 settings write race | **Confirmed by code** (no lock) | [C] `tenancy.service.ts` |

**"Four bugs, three highlighted":** the previous report's fourth bug was **K7**, found by the new alerts unit test. It was not highlighted because it is low severity.

---

## 4. Client error-handling survey

Counts are of empty or ignoring `catch` blocks per file:

| File | Swallowed errors |
|---|---|
| `SalesView` | 31 |
| `auth.real` | 8 |
| `AiView` | 6 |
| `custom-taxonomy` | 5 |
| `AppShell` | 4 |
| `ProductsView` | 4 |
| `AlertsView` | 4 |
| `machines` | 4 |

`ExpensesView`, `PeopleView` and the stock modals check `res.ok` and surface errors. The pattern to remove is **success UI before the server answer, with no rollback**: the sales record, stock deduction, undo, and machine balances.
