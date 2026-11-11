# Hesba — Full System Failure Audit

- **Date:** 2026-11-09
- **Commit audited:** `0b4402e` (branch `feature/sandwich-add-to-sale`), with a clean working tree.
- **Type:** audit only. **No application code, schema or data fix was made.** The only repository file this audit adds is this report.
- **Audience:** the owner and developers who will plan and make the fixes.
- **Related documents:**
  - `docs/audits/USER-FACING-ERRORS.md` (UE-01…UE-20, K1–K10).
  - `docs/audits/BUG-FIX-ROADMAP.md`.

  Every earlier item that is still present was **re-tested here against the running app**. This report notes which ones were reproduced again and which are confirmed by code only.

---

## How to read this report

**Evidence tags:**

| Tag | Meaning |
|---|---|
| **[API]** | Reproduced with HTTP requests against the running app |
| **[UI]** | Reproduced by clicking in a real browser (Playwright Chromium) |
| **[DB]** | Observed in the database rows |
| **[T]** | Shown by an automated test in the repository |
| **[C]** | Confirmed by reading the code path end to end, not reproduced |
| **[LOG]** | Seen in the server log |

**Severity:**

| Level | Meaning |
|---|---|
| **P0** | Data loss, financial corruption or a security breach |
| **P1** | A major business flow is broken or misleading |
| **P2** | A significant bug with a workaround |
| **P3** | A minor bug or UI/UX issue |
| **P4** | Cosmetic, or an improvement |

**Environment codes:**

| Code | Meaning |
|---|---|
| **DEV** | `pnpm dev` on `localhost:3000` (webpack, service worker disabled) |
| **PROD** | `next build` + `next start` on `localhost:3100`, built from the same commit in an isolated worktree |
| **DB** | Both servers used the same remote Neon development database, `neondb` (PostgreSQL 18.6) |

---

## 1. Executive summary

| | Count |
|---|---|
| **Total issues** | **59** |
| P0 | 4 |
| P1 | 9 |
| P2 | 21 |
| P3 | 22 |
| P4 | 3 |

**The most serious problems:**

1. **Selling a normal product never records a sale, but stock still goes down** (QA-01). Every ordinary sale returns 500 on the server while the screen shows success. Only sandwich sales are saved.
2. **Concurrent writes corrupt stock and money.**
   - Stock adjustments and stock additions lose updates when two requests overlap (QA-02).
   - So do POS-machine balance deductions (QA-03).
   - The append-only ledger then records wrong `balance_after` values.
   - A real double tap on a product tile reproduced this.
3. **Offline work is silently lost** (QA-04). An offline sale shows "تم تسجيل بيع" and the sync bar says "0 pending". Nothing is ever sent after reconnecting.
4. **The Home dashboard shows wrong numbers.**
   - Sales and expenses always appear as 0, because of field-name mismatches (QA-06).
   - Profit is an invented 25% estimate (QA-07).
   - "Purchases" is inflated about 11× (QA-08).
5. **After logout, the previous shop's data is still readable offline** from the service-worker cache (QA-13).

**What held up well:**

- **Tenant isolation.** No cross-shop read, write or delete succeeded in about 40 manipulation attempts across products, stock, sales, sandwiches, people, expenses, machines and promotions. Some attempts returned 500 instead of 404 (QA-42).
- **The sandwich sale path.** Six parallel sales against stock for three sold exactly three, and the other three got a correct 409. Ingredients were deducted exactly once. Idempotency by `opId` works.
- **Stock-add and debt-payment idempotency by `opId`** works.

**Areas tested:** authentication, sessions, tenant isolation, products, inventory, sales, sandwiches, customers and payables, expenses, POS machines, promotions, alerts, AI, catalog sync, offline/PWA, the dashboard, responsive layout at 5 widths, API error handling, races, idempotency and security headers.

**Areas blocked (feature not implemented):** see §3.

| Area | Status |
|---|---|
| Multi-item cart and invoices | Not implemented |
| Credit sale with customer selection | Not implemented |
| Returns / refunds | Not implemented |
| Discounts and payment methods | Not implemented |
| Purchase recording | Not implemented |
| Passkey / PIN login | Not implemented |
| Magic-link recovery | Not implemented |
| Outbox / sync | Not implemented |

---

## 2. Critical issues (P0 and P1)

| ID | Sev | Title |
|---|---|---|
| QA-01 | P0 | Ordinary sales are never saved, but stock is deducted and the UI shows success |
| QA-02 | P0 | Concurrent stock writes lose updates and corrupt the stock ledger |
| QA-03 | P0 | Concurrent POS-machine deductions lose updates (money) |
| QA-04 | P0 | Offline sale shows success and is never synced |
| QA-05 | P1 | Stock cache, batches and movement ledger disagree for the same product |
| QA-06 | P1 | Home "التقرير" always shows 0 sales, 0 expenses and 0 profit |
| QA-07 | P1 | Home invents cost of goods (75% of revenue) and profit (25%) |
| QA-08 | P1 | Batch cost is stored as a total and read as per-unit; "purchases" inflated about 11× |
| QA-09 | P1 | Sales screen totals include sales the server rejected |
| QA-10 | P1 | Undo sale always fails on the server |
| QA-11 | P1 | Saving the store profile always fails |
| QA-12 | P1 | Overpayment creates a hidden credit; editing the balance then fabricates a debt entry |
| QA-13 | P1 | After logout, the shop's data is still served offline from the service-worker cache |

---

## 3. Flow results

| # | Flow | Result | Notes |
|---|---|---|---|
| 1 | Registration | **PASS** | Validation and duplicates are correct (409 for phone and email, including the `+20` form). No maximum length on names (QA-58). |
| 2 | Login / logout | **PARTIAL** | Works. Lockout counts successful logins and returns 400 (QA-24). Timing leak (QA-38). |
| 3 | Session lifecycle | **FAIL** | "Sign out other devices", logout or rotation followed by any request with an old token logs the user out everywhere (QA-14). Sessions do not slide (QA-51). |
| 4 | Password recovery | **PARTIAL** | Wrong or malformed codes are handled. Known vs unknown email leaks through 503 vs 200 (QA-25). In DEV the email provider fails, so the flow can't complete. |
| 5 | Passkey / PIN / magic link | **BLOCKED** | Tables exist; no routes or UI. |
| 6 | Profile edit | **FAIL** | 500 on every save (QA-11). |
| 7 | Tenant isolation (API) | **PASS** | No leak. Several attempts return 500 or a false 200 instead of 404 (QA-35, QA-42). |
| 8 | Products: create / edit / hide / delete | **PARTIAL** | Works. Duplicate names → 500 (QA-23). No upper bounds (QA-15). English search fails (QA-48). Delete with history archives correctly, and sales history keeps names. |
| 9 | Inventory lifecycle | **FAIL** | Races (QA-02). Three-way disagreement (QA-05). Silent clamp on oversell (QA-16). 10¹² units accepted (QA-15). |
| 10 | Sale A: one normal product | **FAIL** | QA-01. |
| 11 | Sale B: several products together | **BLOCKED** | No cart: one tap = one single-line sale. |
| 12 | Sale C: sandwich | **PASS** | Via API and UI: cost 11.00, sale ×2 = 30.00, ingredients deducted once. |
| 13 | Sale D: insufficient stock | **PARTIAL** | Sandwich: rejected, no partial write. Ordinary product: clamps silently (QA-16). |
| 14 | Sale E: concurrent sales | **PARTIAL** | Sandwich: correct. Ordinary (stock adjust path): lost updates (QA-02). |
| 15 | Returns / refunds | **BLOCKED** | Not implemented. Undo is broken (QA-10). |
| 16 | Credit sale and customer debt | **PARTIAL** | Credit sale is not implemented. The manual debt ledger works, but overpayment and balance editing corrupt it (QA-12). |
| 17 | Suppliers / payables | **PARTIAL** | Manual ledger works. Purchases are never recorded (QA-30). Overpayment is hidden. |
| 18 | Expenses | **PARTIAL** | CRUD works, with correct piasters (123.45 → 12345). Bad dates roll over (QA-37). No idempotency (QA-27). Double tap in the UI is blocked correctly. |
| 19 | Reports / dashboard | **FAIL** | QA-06, QA-07, QA-08. |
| 20 | POS machines | **FAIL** | Race (QA-03). NaN/decimal → 500 (QA-36). |
| 21 | Promotions | **FAIL** | Invalid offers accepted and shown to the cashier (QA-20). |
| 22 | Alerts | **PARTIAL** | Data correct. Request loop (QA-28). |
| 23 | AI assistant | **PARTIAL** | Quota and history work. Upstream 503 → 500 after 72 s (QA-29). |
| 24 | Offline: app shell and reload (PROD) | **PASS** | Pages and cached data load offline. |
| 25 | Offline: writes and sync (PROD) | **FAIL** | QA-04, QA-17. |
| 26 | Logout privacy offline (PROD) | **FAIL** | QA-13. |
| 27 | Responsive 360/390/768/1280/1920 | **PARTIAL** | Home overflows with large numbers (QA-44). Small targets (QA-46). Duplicate labels (QA-45). |
| 28 | Realistic journey (signup → stock → sell → sandwich → expense → dashboard → offline) | **FAIL** | Breaks at the ordinary sale, the dashboard and offline sync. |

---

## 4. Complete issue register

Issues are ordered by severity. Each one lists, in this order:

1. ID, severity, category, area and environment
2. Steps to reproduce
3. Expected behavior
4. Actual behavior
5. Evidence
6. Root cause
7. Impact
8. Frequency
9. Suggested fix
10. Regression risk

### P0

#### QA-01 · P0 · Ordinary sales are never saved, but stock is deducted and the UI shows success
- **Category:** data loss / financial · **Area:** Sales · **Env:** DEV + PROD · **Links:** UE-01, K1, K2
- **Steps:**
  1. Create a product with stock.
  2. Open البيع and tap its tile. Tapping twice is enough.
- **Expected:** one sale and its line are saved, stock goes down in the same transaction, and failures are shown.
- **Actual:**
  - The browser fires `POST /api/stock` (adjust −qty) → **200** and `POST /api/sales` → **500**.
  - The tile flashes, the sale is added to the local list, and the only signal is `console.warn("Sale persist notice: server status 500")`.
  - Over the API, every ordinary sale variant returns 500: by variant, by an unknown name (which auto-creates a product), and with amount 0.
- **Evidence:**
  - [UI] PROD journey: `["500 POST /api/sales","500 POST /api/sales","200 POST /api/stock","200 POST /api/stock"]`; server sales = 0.
  - [API] probe `SALE` lines.
  - [LOG] 23× `prisma.sale.create()` failures.
  - [T] 4 `it.fails` in `sales-api.spec.ts`.
- **Root cause:**
  - `recordSale` sets both `store_variant_id` and `store_product_id` on the line (`sales.service.ts` ~L265–278), which violates `chk_sale_lines_exactly_one_target`.
  - The client deducts stock in a separate request (`SalesView.tsx` ~L700) and never checks the sale result.
- **Impact:** no revenue on the server, stock lower than reality, and the dashboard and AI have no sales.
- **Frequency:** 100% of ordinary sales.
- **Fix:** one server transaction (sale + one-target line + FEFO depletion + `opId`), with no client-side stock request (Roadmap Phase 1 + 2).
- **Regression risk:** high. It touches the sale, stock, promotion bundle and service/machine sale paths.
- **Status (2026-11-10):** fixed on branch `fix/qa-01-qa-02-sales-stock-concurrency` (ADR-0019). Verified by `tests/integration/sales-api.spec.ts`, `tests/e2e/sales-atomic.spec.ts`, and the real app with the dev database.

#### QA-02 · P0 · Concurrent stock writes lose updates and corrupt the stock ledger
- **Category:** race condition / inventory · **Area:** Inventory · **Env:** DEV · **Links:** UE-07
- **Steps:**
  1. **Adjust race:** set a variant to 100, then send 10 parallel `POST /api/stock {action:"adjust", mode:"delta", deltaQuantityBase:-1}`.
  2. **Add race:** send 8 parallel `action:"add"` of 100 g to cheese at 2000 g.
- **Expected:** final 90; cheese 2800 g.
- **Actual:**
  - Adjust race: all 10 return 200, but the final level is **98**.
  - Add race: all 8 return 200. The ledger rows each record `balance_after_base = 2100`, and the cache ends at **2100 instead of 2800**.
  - In the browser, a double tap on a tile sent two −1 adjustments (both 200), and stock fell by only **1**.
- **Evidence:**
  - [API] `RACE` lines.
  - [DB] `stock_movements` for "بيبسي تدقيق": `adjustment:-1->99` ×4 and `->98` ×6.
  - [DB] cheese: `purchase:100->2100` ×8.
  - [UI] PROD journey: stock 20 → 19 after two deductions.
- **Root cause:** read-then-write of `stock_levels` and batches under READ COMMITTED, with no row lock or atomic increment (`inventory.service.ts`). Only the sandwich path locks (`FOR UPDATE`).
- **Impact:** wrong stock with two devices or a double tap. The "append-only" ledger itself holds wrong running balances.
- **Frequency:** every overlapping request on the same variant.
- **Fix:** `SELECT … FOR UPDATE` on the level row and batches (as the sandwich path already does), or atomic increments. Then recompute the cache from the ledger.
- **Regression risk:** medium (deadlocks if lock order differs; follow the id-ordered locking already used for sandwiches).
- **Status (2026-11-10):** fixed on branch `fix/qa-01-qa-02-sales-stock-concurrency` (ADR-0019). Verified by `tests/integration/sales-concurrency.spec.ts` (which fails on the previous code) and concurrent requests against the real app.

#### QA-03 · P0 · Concurrent POS-machine deductions lose updates (money)
- **Category:** financial / race · **Area:** Machines · **Env:** DEV · **Links:** UE-06
- **Steps:** set a machine balance to 100.00, then send 5 parallel `POST /api/machines/deduct {amountPiasters:3000}`.
- **Expected:** at most 3 succeed and the balance is 10.00, or the others are rejected for insufficient balance.
- **Actual:**
  - All 5 return 200.
  - The balance is **70.00**.
  - The ledger has 5 rows of −30.00, each with `balance_after_piasters = 7000`.
- **Evidence:** [API] `RACE 5 parallel deduct`; [DB] `pos_machine_topups` for "فوري تدقيق": `-3000->7000` ×5.
- **Root cause:** `machines.service.ts` reads the stored balance and writes `old − amount`, with no lock, no conditional update and no `opId`.
- **Impact:** the machine balance shows money that was already spent, and the ledger contradicts the balance.
- **Frequency:** any overlapping operation: a double tap, two devices, or a retry.
- **Fix:** `UPDATE … SET balance = balance − $1 WHERE balance >= $1 RETURNING`, plus an `opId`.
- **Regression risk:** low–medium.

- **Status (2026-11-10):** fixed on branch `fix/qa-03-qa-04-money-offline` (ADR-0020). Verified by `tests/integration/machines-concurrency.spec.ts` (15 of 17 fail on the previous code) and concurrent requests against the real app.

#### QA-04 · P0 · Offline sale shows success and is never synced
- **Category:** offline / phantom success · **Area:** Sales, PWA · **Env:** PROD (service worker active) · **Links:** UE-09
- **Steps:**
  1. In a PROD build, visit the app online so the service worker takes control.
  2. Go offline and open البيع.
  3. Tap a product tile.
  4. Reconnect and wait 20 s.
- **Expected:** the sale is queued with a visible pending count and synced once, or the app clearly refuses because it is offline.
- **Actual:**
  - Toast: "تم تسجيل بيع: كولا رحلة (1 قطعة) بـ 10 ج.م".
  - The sync bar says **"0 عمليات مستنية (أوفلاين)"**.
  - After reconnecting it says "متزامن ✓", while the server still has 1 sale (only the earlier sandwich) and the stock is unchanged.
  - The sale exists only in that browser's `localStorage`.
- **Evidence:** [UI] `qa-journey-prod.log`, screenshots `qa-j-prod-6/7-offline-*.png`.
- **Root cause:** there is no outbox or sync engine. Writes are fire-and-forget `fetch`es, and the SyncBar's pending count is never computed (`AppShell.tsx`, `SyncBar.tsx`).
- **Impact:** offline sales are lost, while the user believes they are saved. AGENTS.md rule 2 (offline-first) is violated.
- **Frequency:** every offline write.
- **Fix:** either an outbox + sync (needs its own ADR), or block writes offline with a clear message until then.
- **Regression risk:** high (architectural).

### P1

- **Status (2026-11-10):** fixed for sales on branch `fix/qa-03-qa-04-money-offline` (ADR-0020). Verified by `tests/unit/client/sale-outbox.spec.ts`, `tests/e2e/offline-sales.spec.ts` (real IndexedDB, real dev database) and the real app. The offline stock-conflict rule (D32) needs owner confirmation.

#### QA-05 · P1 · Stock cache, batches and movement ledger disagree for the same product
- **Category:** data consistency · **Area:** Inventory · **Env:** DEV
- **Steps:** add stock, then adjust (set and delta), waste and oversell the same variant.
- **Expected:**

  ```
  stock_levels
  = Σ batches.remaining
  = Σ movements
  ```

- **Actual:** "بيبسي تدقيق" has a level of **98**, Σ batch remaining **10,096** and Σ movements **90**. Three different answers to "how many do I have".
- **Evidence:** [DB] query in §7.
- **Root cause:**
  - `adjust`/`clear` change `stock_levels` and write movements but do not deplete batches.
  - The races of QA-02 corrupt the cache.
  - The oversell clamp (QA-16) records a smaller delta.
- **Impact:** expiry alerts and FEFO work from batches that don't exist; valuation and "low stock" work from a cache that is wrong.
- **Frequency:** any shop that adjusts stock.
- **Fix:**
  - One source of truth: the ledger, with the cache derived.
  - Adjustments write batch takes.
  - A periodic reconciliation check.
- **Regression risk:** medium.

- **Status (2026-11-11):** fixed on branch `fix/qa-05-qa-08-inventory-reporting` (ADR-0021). Verified by `tests/integration/inventory-reporting.spec.ts` and the real app.

#### QA-06 · P1 · Home "التقرير" always shows 0 sales, 0 expenses and 0 profit
- **Category:** financial reporting / API contract · **Area:** Home · **Env:** PROD + DEV
- **Steps:** sell 2 sandwiches (30.00, saved on the server), record an expense of 123.45, then open الرئيسية → التقرير → النهارده.
- **Expected:** sales 30.00, expenses 123.45.
- **Actual:** "المبيعات 0 ج.م · 0 بيعة … المصروفات 0 ج.م".
- **Evidence:** [UI] `qa-j-prod-5-home-0.png`, journey log. [C] field mismatch:

  | Data | Home reads | API returns |
  |---|---|---|
  | Sales | `s.createdAt`, `s.totalPiasters`, `s.items` (`HomeView.tsx` L202, L212, L219) | `timestamp`, `amountPiasters` |
  | Expenses | `e.createdAt`, `e.amountPiasters` (L206, L242) | `created_at`, `amount_piasters` |

  `new Date(undefined)` is invalid, so every record is filtered out.
- **Root cause:** the client types don't match the API shape, and no shared zod response schema exists.
- **Impact:** the owner sees zero revenue and zero expenses even when the data is correct on the server.
- **Frequency:** always.
- **Fix:** share response schemas from `src/schemas`; map the fields; add a contract test.
- **Regression risk:** low.

- **Status (2026-11-11):** fixed on branch `fix/qa-05-qa-08-inventory-reporting` (ADR-0021). Verified by `tests/integration/inventory-reporting.spec.ts` and the real app.

#### QA-07 · P1 · Home invents cost of goods (75% of revenue) and profit (25%)
- **Category:** financial / invented numbers · **Area:** Home · **Env:** code, visible once QA-06 is fixed
- **Steps:** read `HomeView.tsx` L215–235 and L279–349.
- **Expected:** cost from `sale_lines.cost_piasters` or FEFO movement costs. Otherwise "unknown".
- **Actual:**
  - `cogs += Math.round(total * 0.75)` whenever a sale has no items, which is always (the API returns no items).
  - Hourly, daily, product and category profit use `* 0.25`.
  - The matching that does happen is by product **name**.
- **Evidence:** [C].
- **Root cause:** a placeholder estimate.
- **Impact:** profit shown to the owner is fabricated. This violates AGENTS.md rule 10 ("no invented numbers"). Sandwich cost snapshots are ignored.
- **Frequency:** always.
- **Fix:** compute profit server-side from recorded costs, and show "—" where cost is unknown.
- **Regression risk:** low.

- **Status (2026-11-11):** fixed on branch `fix/qa-05-qa-08-inventory-reporting` (ADR-0021). Verified by `tests/integration/inventory-reporting.spec.ts` and the real app.

#### QA-08 · P1 · Batch cost is stored as a total and read as per-unit; "purchases" inflated about 11×
- **Category:** financial · **Area:** Inventory, Home · **Env:** PROD · **Links:** UE-19
- **Steps:** add 20 cola at a total of 160.00, 20 bread at 60.00 and 1000 g cheese at 160.00 (real spend: 380.00). Then open Home → التقرير.
- **Expected:** "مشتريات دخلت المخزن 380 ج.م".
- **Actual:** **4,264 ج.م**. The batch row stores `costPricePiasters: 16000` for 20 units, and other code multiplies it by the quantity.
- **Evidence:** [UI] `qa-j-prod-5-home-0.png`; [API] batch `costPricePiasters 16000, receivedQty 20`.
- **Root cause:** the Add-Stock screen sends a total, while the FEFO engine, the initial-stock path and the views read `cost_price_minor` as per-unit.
- **Impact:** purchases, valuation and movement costs are wrong by the batch quantity.
- **Frequency:** every stock intake.
- **Fix:** store the unit cost and `cost_total_minor` explicitly; backfill.
- **Regression risk:** medium (needs a data migration).

- **Status (2026-11-11):** fixed on branch `fix/qa-05-qa-08-inventory-reporting` (ADR-0021). Verified by `tests/integration/inventory-reporting.spec.ts` and the real app.

#### QA-09 · P1 · Sales screen totals include sales the server rejected
- **Category:** stale/phantom state · **Area:** Sales · **Env:** PROD · **Links:** UE-02, UE-05
- **Steps:** follow QA-01, then look at "مبيعات النهارده" and "آخر البيعات".
- **Expected:** only saved sales.
- **Actual:**
  - The screen shows **40 ج.م** today (2 cola + sandwiches) while the server has 30.00.
  - The list is read from `localStorage`, and it is replaced by server data only when the server returns at least one sale.
- **Evidence:** [UI] `qa-j-prod-7-offline-after-sale.png`; `localStorage hesba_sales_records` length 2 while the server has 0 cola sales.
- **Root cause:** `SalesView.tsx` ~L219–270 and L463–473.
- **Impact:** the cashier's daily total doesn't match reality, and it differs per device.
- **Frequency:** always, with QA-01.
- **Fix:** the server is the source; unsynced items are shown separately.
- **Regression risk:** low.

- **Status (2026-11-12):** fixed on branch `fix/qa-09-qa-12-sales-profile-ledger` (ADR-0022). Verified by `tests/unit/client/sales-view.spec.tsx`, `tests/unit/client/sales-server-source.spec.ts`, `tests/e2e/sales-void.spec.ts`.

#### QA-10 · P1 · Undo sale always fails on the server
- **Category:** broken flow · **Area:** Sales · **Env:** DEV · **Links:** UE-03, K3
- **Steps:** `DELETE /api/sales?id=<id>`.
- **Expected:** a reversing `sale.void`: stock restored from the recorded takes, and the sale marked void.
- **Actual:**
  - 500 for real ids and for unknown ids.
  - The UI still adds the stock back and drops the sale locally.
- **Evidence:** [API] `BADID DELETE /api/sales` → 500; [T] `sales-api.spec.ts`; [C] `deleteSale` uses `deleteMany`, and the app role has no DELETE grant.
- **Root cause:** sales are append-only by design; undo was written as a hard delete.
- **Impact:** once QA-01 is fixed, an undone sale would stay recorded while its stock is added back.
- **Frequency:** every undo.
- **Fix:** Roadmap Phase 3 (`voidSale`). Ship it together with QA-01.
- **Regression risk:** medium.

- **Status (2026-11-12):** fixed on branch `fix/qa-09-qa-12-sales-profile-ledger` (ADR-0022). Verified by `tests/integration/sales-void.spec.ts`.

#### QA-11 · P1 · Saving the store profile always fails
- **Category:** broken flow · **Area:** Profile · **Env:** DEV · **Links:** UE-04, K4
- **Steps:** `PUT /api/auth/profile` with valid data.
- **Expected:** 200.
- **Actual:** 500 "حصل خطأ غير متوقع في السيرفر. شغلك محفوظ."
- **Evidence:** [API] `AUTH profile PUT (K4)`; [T] `profile-api.spec.ts`.
- **Root cause:** `stores` is updated outside `withTenant`, so FORCE RLS hides the row (P2025). The phone is also saved without normalization, which would break login if only RLS were fixed.
- **Impact:** owners can't edit the shop or owner details.
- **Frequency:** always.
- **Fix:** Roadmap Phase 4.
- **Regression risk:** low.

- **Status (2026-11-12):** fixed on branch `fix/qa-09-qa-12-sales-profile-ledger` (—). Verified by `tests/integration/profile-api.spec.ts`.

#### QA-12 · P1 · Overpayment creates a hidden credit; editing the balance then fabricates a debt entry
- **Category:** financial integrity · **Area:** People (customers, payables) · **Env:** DEV · **Links:** UE-11 (extends it)
- **Steps:**
  1. Customer owes 100.00. Pay 30, then 10 + 10 (no `opId`), then **9,999.99**.
  2. Add 5 debts of 1.00.
  3. `PATCH /api/people/<id> {amountPiasters:0}`.
- **Expected:** the overpayment is rejected, or a credit balance is shown. Editing a balance must not invent transactions.
- **Actual:**
  - The overpayment is accepted, and the balance is displayed as **0** (floored).
  - The 5 later debts are absorbed invisibly: the balance stays 0.
  - The edit inserted a new `owed_to_me` entry of **9,943.99**, dated today, to cancel the credit.
  - The payee section behaves the same: paying 50 against 30 → 0.
- **Evidence:** [DB] `debt_entries` for customer `ca9a0444…` (see §7); [API] `PEOPLE overpayment`, `edit opening balance -> 0`.
- **Root cause:**
  - `Math.max(0, …)` on displayed balances (`customer.service.ts` L95/271/280, `payable.service.ts`).
  - The "opening balance" edit writes a balancing entry instead of editing the opening entry.
- **Impact:** customer statements show a debt that never happened, and debts can disappear. These ledgers are what the shop uses to collect money.
- **Frequency:** any overpayment, and any later balance edit.
- **Fix:**
  - Reject or confirm overpayments, and show credit balances (negative).
  - A balance edit must be an explicit labelled adjustment, approved by the owner.
- **Regression risk:** medium.

- **Status (2026-11-12):** fixed on branch `fix/qa-09-qa-12-sales-profile-ledger` (ADR-0023). Verified by `tests/integration/people-ledger.spec.ts`.

#### QA-13 · P1 · After logout, the shop's data is still served offline from the service-worker cache
- **Category:** privacy/security · **Area:** PWA · **Env:** PROD
- **Steps:**
  1. Use the app (products, sales, people, expenses).
  2. Log out.
  3. Go offline and open `/app/products`.
- **Expected:** no shop data is available after logout.
- **Actual:**
  - `fetch("/api/products?filter=all")` returns **200** with the shop's product list, from the cache.
  - The page renders "أضافه المحل (4)" etc. under "الوضع غير متصل".
  - The `apis` cache also holds `/api/sales`, `/api/expenses?period=all`, `/api/machines`, `/api/alerts` and `/api/promotions`.
- **Evidence:** [UI] journey log `after logout + offline`, `qa-j-prod-10-logged-out-offline.png`; the cache listing.
- **Root cause:** Serwist `defaultCache` caches same-origin `/api/*` GET responses (NetworkFirst). Logout does not clear the caches, and cache keys are not per-user.
- **Impact:** on a shared or second-hand phone, the next person can read sales, debts and expenses.
- **Frequency:** every logout on a device that used the app.
- **Fix:** exclude `/api/` from runtime caching, or key it per session and clear it on logout (`caches.delete`).
- **Regression risk:** low.

### P2

#### QA-14 · P2 · Using any revoked session token logs the user out on every device
- **Category:** authentication · **Area:** Sessions · **Env:** DEV
- **Steps:**
  1. Log in on phone A and phone B.
  2. Phone A: "تسجيل الخروج من الأجهزة الأخرى" (`/api/auth/revoke-other-sessions`).
  3. Phone B opens the app.
  4. Phone A makes any request.
- **Expected:** phone B is logged out; phone A stays logged in.
- **Actual:** phone A also gets 401: "تم رصد استخدام رمز جلسة قديم، وتم إلغاء كافة الجلسات النشطة لحماية حسابك."
  - The same happens after a normal logout followed by a request with the old token.
  - It also happens after `/api/auth/rotate` while requests carrying the old token are still in flight.
- **Evidence:** [API] `qa-auth2.log`.
- **Root cause:** `session.service.ts` L142–163 treats any `revokedAt != null` token as theft. Logout, revoke-others and rotation all set `revokedAt`.
- **Impact:**
  - The owner gets locked out of their own devices.
  - Anyone holding an old (logged-out) token can force-logout the account everywhere, which is a denial-of-service.
- **Frequency:** every "sign out other devices"; becomes routine once sliding sessions (rotation) are implemented.
- **Fix:** apply reuse detection only to **rotated** tokens, with a short grace period. Logged-out and revoked tokens simply return 401.
- **Regression risk:** low.

#### QA-15 · P2 · No upper bounds on quantities and money
- **Category:** validation / financial · **Area:** Products, Stock, Expenses, Machines · **Env:** DEV
- **Steps:** add stock `quantityBase: 10^12`; create a product priced 10¹⁵ piasters; create an expense of 10¹⁵ piasters.
- **Expected:** rejected with a clear message. Sandwiches already do this ("سعر البيع كبير قوي").
- **Actual:**
  - All accepted.
  - The Home inventory shows "7,000,000,000,001,639.80 ج.م".
  - Today's expense total is 10,000,000,000,273.31 ج.م.
- **Evidence:** [API] probe; [UI] `qa-home-360.png`.
- **Root cause:** zod schemas have `.positive()` but no `.max()`.
- **Impact:** one typo (extra zeros) ruins every total. Values beyond 2⁵³ would also lose precision in JavaScript.
- **Frequency:** on input error.
- **Fix:** shared sane limits in `domain/constants`.
- **Regression risk:** low.

#### QA-16 · P2 · Overselling or over-adjusting silently zeros the stock
- **Category:** inventory · **Area:** Stock · **Env:** DEV · **Links:** UE-08, K5
- **Steps:** apply a delta of −(stock + 50).
- **Expected:** rejection, or "allow and flag negative" (docs D13/O9).
- **Actual:** 200, the level becomes 0, and a smaller delta is recorded. No warning.
- **Evidence:** [API] `K5 delta`; [T] `inventory-stock.spec.ts` fails (1 integration failure).
- **Root cause:** an intentional clamp in `inventory.service.ts`.
- **Impact:** sales beyond the recorded stock vanish from the ledger.
- **Fix:** owner decision (Roadmap Phase 0), then implement it.
- **Regression risk:** low.

#### QA-17 · P2 · The sync bar misreports status
- **Category:** misleading UI · **Area:** App shell · **Env:** PROD · **Links:** UE-09
- **Actual:**
  - Offline, after a "successful" sale, it shows "0 عمليات مستنية".
  - Online, it shows "متزامن ✓" while sales are failing with 500.
- **Evidence:** [UI] journey.
- **Root cause:** `pendingCount` is never computed, and the state follows `navigator.onLine` only.
- **Fix:** reflect real queue and failure state, or remove the counter until an outbox exists.
- **Regression risk:** low.

#### QA-18 · P2 · Malformed JSON returns 500 with "شغلك محفوظ" on 20 endpoints
- **Category:** API errors / misleading message · **Area:** API · **Env:** DEV + PROD
- **Steps:** send the body `{not json` to `POST /api/products` (and the other endpoints listed).
- **Expected:** 400 "البيانات غير صحيحة".
- **Actual:** **500** "حصل خطأ غير متوقع في السيرفر. شغلك محفوظ." ("your work is saved", which is false). Affected endpoints:

  | Area | Endpoints |
  |---|---|
  | Products | `POST /api/products`, `PATCH /api/products` |
  | Stock | `POST /api/stock` |
  | Sales | `POST /api/sales/config` |
  | People | `POST /api/people`, `PATCH /api/people/x`, `POST /api/people/x/transactions` |
  | Expenses | `POST /api/expenses`, `PATCH /api/expenses`, `PATCH /api/expenses/x` |
  | Machines | `POST /api/machines`, `/api/machines/topup`, `/api/machines/deduct`, `/api/machines/adjust` |
  | Other | `/api/promotions`, `/api/store/custom-taxonomy`, `/api/ai/chat`, `/api/auth/profile`, `/api/auth/signup`, `/api/auth/login` |

  Only `/api/sales` and `/api/sandwiches` (which use `readJsonBody`) return 400.
- **Evidence:** [API] `MALFORMED` lines; [LOG] 35× `Expected property name…`.
- **Root cause:** routes call `await req.json()` directly, and `toSafeErrorResponse` maps `SyntaxError` to 500.
- **Fix:** use `readJsonBody` everywhere; map `SyntaxError` → 400; reword the 500/503 messages.
- **Regression risk:** low.

#### QA-19 · P2 · Invalid or non-existent ids return 500 instead of 400/404
- **Category:** API errors · **Area:** People, Expenses, Products, Machines, Stock, AI, Sales · **Env:** DEV + PROD
- **Actual (500 on all of these):**

  | Area | Requests that return 500 |
  |---|---|
  | People | `GET/PATCH/DELETE /api/people/<unknown or malformed>`, `POST …/transactions` on an unknown or deleted person, GET of a deleted customer |
  | Expenses | `PATCH/DELETE /api/expenses/<unknown>`, deleting an already-deleted expense, editing a deleted expense |
  | Products | `DELETE /api/products?id=<unknown uuid or "nope">` (hide) |
  | Machines | `DELETE /api/machines?id=nope`, `POST /api/machines/topup` with `machineId:"not-a-uuid"` |
  | Stock | `DELETE /api/stock?batchId=nope` |
  | AI | `GET /api/ai/conversations/nope` |
  | Sales | `DELETE /api/sales?id=<any>` |
  | Expenses list | `GET /api/expenses?period=custom&from=garbage` |

- **Evidence:** [API] `BADID`; [LOG] "Error creating UUID, invalid character" and plain `Error("الشخص أو المورد غير موجود…")`.
- **Root cause:**
  - Services throw plain `Error` instead of `AppError.notFound`.
  - There is no UUID validation before Prisma.
  - P2025 is not mapped to 404.
- **Impact:** every 500 is logged as an internal error, which hides real incidents. Users see "server error" for a deleted record.
- **Fix:** validate ids; typed `AppError`s; map P2025 → 404 and P2002 → 409.
- **Regression risk:** low.

#### QA-20 · P2 · Promotions accept invalid offers, which are shown to the cashier
- **Category:** validation / financial · **Area:** Promotions, Sales · **Env:** DEV
- **Steps:** `POST /api/promotions` with any of:
  - promo price 50.00 above an original of 24.00;
  - `items: []`;
  - a non-existent variant id.
- **Expected:** 400.
- **Actual:**
  - All return 200.
  - The Sales screen shows "كومبو مجمع 50 ج.م ~~24 ج.م~~" cards with near-invisible titles (see QA-47).
- **Evidence:** [API] `PROMO`; [UI] `qa-sales-360.png`.
- **Root cause:**
  - `promotionSchema` doesn't check that items exist and belong to the store.
  - It doesn't check that `promoPrice < originalPrice`, or that `savings = original − promo`.
  - The client-supplied `id` is trusted.
- **Impact:** a cashier can sell a "discount" that costs more, or a bundle with no stock behind it.
- **Fix:** server-side validation against the store's variants and prices.
- **Regression risk:** low.

#### QA-21 · P2 · Any body sent to `POST /api/sales/config` silently resets the shop's sales screen config
- **Category:** validation / data loss · **Area:** Sales config · **Env:** DEV
- **Steps:** POST `{"anything": "x"…}` or `[1,2]`.
- **Expected:** 400.
- **Actual:** 200, and the config becomes `{enabledServiceIds:[], enabledProductIds:[]}`. The shop's chosen tiles are erased.
- **Evidence:** [API] `CONFIG`.
- **Root cause:** `saveSalesViewConfig` builds the config from missing fields with defaults; there is no schema.
- **Fix:** zod schema; reject unknown shapes.
- **Regression risk:** low.

#### QA-22 · P2 · The People API reads `"50"` as 0.50 EGP but `"50.00"` as 50 EGP
- **Category:** money / unit conversion · **Area:** People · **Env:** DEV
- **Steps:** create people with `amountPiasters: "50"` and with `"50.00"`.
- **Expected:** one unit rule.
- **Actual:**
  - `"50"` → 50 piasters; the card shows **0.50 ج.م**.
  - `"50.00"` → 5000 piasters.
  - A float `10.7` → 11 piasters (silently rounded).
- **Evidence:** [API] `PEOPLE amount as string`; [UI] `qa-people-360.png` (زبون نص 0.50).
- **Root cause:** `moneyAmountSchema` treats strings with a "." as pounds and strings without one as piasters (`schemas/people.ts`).
- **Impact:** any client or integration that sends a string loses a factor of 100. A latent trap for the outbox.
- **Fix:** accept integer piasters only on the API, and parse pounds only in the UI.
- **Regression risk:** low.

#### QA-23 · P2 · Creating a second product with a name the shop already used fails with 500
- **Category:** transaction bug · **Area:** Products · **Env:** DEV
- **Steps:** create "بيبسي تدقيق", then create a new product with the same name and a different price.
- **Expected:** a second product, or a clear "already exists" message.
- **Actual:** 500.
- **Evidence:**
  - [API] `duplicate name create`.
  - [LOG] `catalogCandidate.findUnique()` → Postgres **25P02** "current transaction is aborted".
- **Root cause:** `community-suggestions.service.ts` ~L231–251 catches a P2002 from `candidateAdoption.create` *inside* the transaction and keeps querying. After any error, Postgres rejects every later statement unless a SAVEPOINT is used.
- **Impact:** common real-world case (two sizes of the same product) blocked with a generic error.
- **Fix:** use `ON CONFLICT DO NOTHING`, a savepoint, or do the candidate work after commit.
- **Regression risk:** low.

#### QA-24 · P2 · Login lockout counts successful logins and returns 400 instead of 429
- **Category:** authentication · **Area:** Login · **Env:** DEV · **Links:** UE-18
- **Steps:** log in successfully 8 times with the same phone.
- **Actual:** `[200 ×5, 400 ×3]` "تجاوزت الحد الأقصى لمحاولات الدخول… 15 دقيقة". Five wrong passwords also lock the phone for 15 minutes, from any IP.
- **Evidence:** [API].
- **Root cause:** `login.service.ts` checks the per-phone limiter before verifying the password, and counts every attempt; it throws `badRequest`.
- **Impact:**
  - A shop with several devices, or an owner re-logging, gets locked out.
  - Anyone who knows the phone can lock the owner out.
- **Fix:** count failures only; return 429; consider IP + phone keys.
- **Regression risk:** low.

#### QA-25 · P2 · Forgot-password reveals whether an email has an account
- **Category:** security / enumeration · **Area:** Recovery · **Env:** DEV
- **Steps:** `POST /api/auth/forgot-password/request` with an unknown email, then with a registered one.
- **Actual:**
  - Unknown → 200 "إذا كان البريد مسجلاً…".
  - Registered → **503** "تعذر إرسال البريد الإلكتروني".
  - Separately, the DEV email provider (Resend sandbox sender) cannot deliver, so recovery can't complete in DEV.
- **Evidence:** [API].
- **Root cause:** the email-send failure is surfaced only for existing users.
- **Fix:** always return the same 200; log and alert on send failures.
- **Regression risk:** low.

#### QA-26 · P2 · No security headers
- **Category:** security · **Area:** All pages · **Env:** DEV + PROD
- **Actual:** none of these headers is sent on `/login` or `/app`:
  - `Content-Security-Policy`
  - `X-Frame-Options` / `frame-ancestors`
  - `X-Content-Type-Options`
  - `Strict-Transport-Security`
  - `Referrer-Policy`
  - `Permissions-Policy`
- **Evidence:** [API] `curl -I`.
- **Impact:** the app can be framed (clickjacking), and there is no XSS defense in depth.
- **Fix:** a `headers()` block in `next.config.ts`.
- **Regression risk:** low (CSP needs care with Next inline scripts).

#### QA-27 · P2 · Most writes are not idempotent; retries and parallel submits duplicate records
- **Category:** idempotency · **Area:** Expenses, People, ordinary Sales, Machines · **Env:** DEV
- **Actual:**
  - 3 parallel identical expenses → 3 rows (777 ×3).
  - 2 payments without an `opId` → both applied.
  - Ordinary sales ignore the client `opId` (the server generates a new one each time).
  - Machines have no `opId` at all.
  - What works: stock add, debt payment with an `opId`, and sandwich sales are idempotent. The expense UI button is disabled while saving, so a UI double tap made one row.
- **Evidence:** [API] `IDEMP`; [DB] expenses.
- **Impact:** a network retry (or the future outbox) duplicates money records.
- **Fix:** accept and enforce a client `opId` on every write (unique `(store_id, op_id)`).
- **Regression risk:** low.

#### QA-28 · P2 · The Alerts screen repeats requests endlessly
- **Category:** performance · **Area:** Alerts · **Env:** DEV · **Links:** UE-20
- **Actual:** in 12 idle seconds: 6–8× `GET /api/machines` and 5× `GET /api/alerts`, at every width. Other screens have no loop.
- **Evidence:** [UI] `qa-survey.json`.
- **Root cause:** `AlertsView.loadMachines` re-fetches on `hesba_machines_updated`, which the fetch itself dispatches.
- **Fix:** same fix as was applied to SalesView.
- **Regression risk:** low.

#### QA-29 · P2 · AI chat waits 72 s, then returns 500 when the provider is busy
- **Category:** external dependency / error mapping · **Area:** AI · **Env:** DEV
- **Actual:** Gemini returned 503 "high demand". The user waited **71.9 s** and got a 500 "تعذر الحصول على رد…". The quota credit was correctly restored.
- **Evidence:** [API], [LOG].
- **Fix:** client-visible timeout (~20 s), map to 503 with a retry hint, and a progress state in the UI.
- **Regression risk:** low.

#### QA-30 · P2 · Purchases from suppliers are never recorded
- **Category:** missing flow / reporting · **Area:** Suppliers, AI · **Env:** code + DB
- **Actual:**
  - `purchases` and `purchase_lines` tables exist, but no route writes them.
  - Adding stock with a supplier does not create a payable.
  - Supplier balances are manual ledger entries only.
  - The AI tool `business-tools.ts` L469 reads `purchases`, which is always empty.
- **Evidence:** [C] grep; [DB].
- **Impact:** payables can drift from what was actually received, and AI answers about purchases are always "none".
- **Fix:** a purchase flow (product decision).
- **Regression risk:** n/a.

#### QA-31 · P2 · Core sales features are missing
- **Category:** missing features · **Area:** Sales
- **Missing:** multi-item cart and invoice, credit sale with customer selection, discounts, payment methods, returns/refunds.
- **Impact:** test flows 11, 15 and 16 are BLOCKED. Credit sales are tracked only through the separate People ledger, so a debt is never linked to a sale or to stock.
- **Fix:** roadmap (V1.1).
- **Regression risk:** n/a.

#### QA-32 · P2 · The development database is slow enough to cause 500s
- **Category:** performance / environment · **Area:** All · **Env:** DEV + PROD on Neon
- **Actual:**
  - Typical reads take 1.2–4.6 s (`/api/stock?view=all` 4.6 s on DEV).
  - Under parallel load, Prisma returns "Unable to start a transaction in the given time" (4×) and "Transaction already closed… timeout 20000 ms" (2×) as 500s.
  - The e2e sandwich spec timed out twice for this reason (QA-54).
- **Evidence:** [LOG], timing table in §5.
- **Impact:** real users on a far or cold database get random 500s. The UI shows nothing for many failures (QA-01 pattern).
- **Fix:** region, pooling and warm-up review; fewer queries per request; surface failures in the UI.
- **Regression risk:** n/a.

#### QA-33 · P2 · Ordinary sale lines store the total as the unit price, and trust the client's amount and timestamp
- **Category:** financial (latent until QA-01 is fixed) · **Area:** Sales · **Env:** code
- **Actual:**
  - `unitPricePiasters: amountPiasters` (the line total) for any quantity.
  - The amount comes from the client with no check against the product's price.
  - `createdAt` is taken from the client's `timestamp`, so a sale dated 2100 is possible.
  - A negative `commissionPiasters` is accepted by the schema.
- **Evidence:** [C] `sales.service.ts` L246–278; `schemas/sale.ts`.
- **Fix:**
  - The server prices the line, as it already does for sandwiches.
  - Unit price = total ÷ quantity.
  - Bound the timestamp to now ± a small skew, or keep only the server time.
- **Regression risk:** medium.

#### QA-34 · P2 · The migrator role bypasses tenant isolation by policy
- **Category:** security (defense in depth) · **Area:** DB · **Env:** DB
- **Actual:**
  - Every tenant table checked has a `<table>_migrator_all` policy (`USING true`) for `hesba_migrator`.
  - `HESBA_DIRECT_URL` connects as `hesba_migrator`, and the roadmap notes it is used at runtime for cron/community work.
  - A query through that client sees every shop. This audit's read-only queries saw other shops' POS machines until they were filtered by `store_id`.
- **Evidence:** [DB] `pg_policies`.
- **Fix:** a dedicated least-privilege runtime role for cron (Roadmap Phase 9); never use the migrator at runtime.
- **Regression risk:** low.

### P3

#### QA-35 · P3 · Operations that change nothing still report success
- **Area:** API
- **Actual (all 200 with "success"):**
  - `PATCH /api/products?id=<unknown or other shop's id>&action=unhide`
  - `DELETE /api/promotions?id=<unknown or other shop's id>`
  - `POST /api/stock {action:"adjust", mode:"delta"}` with no delta (records nothing)
- **Evidence:** [API].
- **Impact:** clients can't detect mistakes. No other shop's data changed (verified).
- **Fix:** return 404 when no row matches.

#### QA-36 · P3 · Machine top-up and adjust mishandle numbers
- **Actual:**
  - Amounts `"abc"`, 0.5, 1.5 and 10²⁰ → 500.
  - The string `"100"` is accepted as 100 piasters.
  - Adjust with `"abc"` → 500.
- **Root cause:** hand-written `Number()` checks instead of a schema; `BigInt(NaN)` / `BigInt(0.5)` throw.
- **Evidence:** [API], [LOG] "The number NaN cannot be converted to a BigInt".

#### QA-37 · P3 · Dates are not validated
- **Actual:**
  - An expense dated `2026-13-45` is saved as **2027-02-14**.
  - Expenses and debts dated 2099 are accepted.
  - A stock `expiryDate: "not-a-date"` → 500.
  - An unknown `period` falls back silently.
- **Evidence:** [API], [DB].
- **Fix:** strict date parsing and a reasonable range.

#### QA-38 · P3 · Login response time reveals whether a phone is registered
- **Actual:** wrong password on an existing phone: 94–107 ms. Unknown phone: 74–81 ms. Measured over HTTP, 3 samples each.
- **Root cause:** the malformed dummy Argon2 hash (UE-10).
- **Fix:** a real dummy hash with the same parameters.

#### QA-39 · P3 · No server-side origin (CSRF) check
- **Actual:** a POST with `Origin: https://evil.example`, and even `Content-Type: text/plain`, was accepted (201) on DEV and PROD when the cookie was present.
- **Mitigation:** in browsers, the cookie is `SameSite=Lax`, so cross-site requests don't carry it today.
- **Risk:** same-site subdomains, older browsers, and any future change of `SameSite`.
- **Fix:** check `Origin`/`Sec-Fetch-Site` on writes; require `application/json`.

#### QA-40 · P3 · The session token is also returned in the JSON body
- **Actual:** signup, login and rotate return `data.sessionToken`. The HttpOnly cookie is therefore not the only copy: any script (XSS) can read the token.
- **Fix:** return the token only as the cookie.

#### QA-41 · P3 · A sandwich still sells after one of its ingredient products is hidden
- **Steps:**
  1. Hide "عيش فينو" (an ingredient).
  2. Sell the sandwich, then open the ingredient list.
- **Actual:**
  - The sale succeeds and consumes the hidden product.
  - The hidden product disappears from the ingredient picker, so editing the sandwich would show a missing product.
- **Evidence:** [API] `SW hide ingredient`.
- **Fix:** product decision. Either block hiding a product used in a sandwich (as delete already does), or warn.

#### QA-42 · P3 · Cross-shop attempts return 500 instead of 404
- **Actual:**
  - Shop B upserting shop A's product id → 500.
  - Shop B hiding it → 500.
  - Shop B reading, editing, paying or deleting shop A's customer → 500.
  - Shop B editing or deleting shop A's expense → 500.
  - Shop B selling shop A's sandwich → 500.
  - **No data leaked and nothing changed** (verified via shop A's lists and the DB).
- **Fix:** same as QA-19.

#### QA-43 · P3 · English unit codes and wrong pack words on Home
- **Actual:** the Home "الجرد" table shows "19 **piece**", "carton 5", and for a 10-piece bread pack "1 **كرتونة** و 8 piece".
- **Evidence:** [UI] journey home text, `qa-home-360.png`.
- **Fix:** translate units through `t()`; use the product's own pack word.

#### QA-44 · P3 · Home scrolls horizontally on phones when numbers are large
- **Actual:** at 360 and 390 px, the page width is 411/415 px. The inventory table is wider than the screen with 13-digit values. Normal values fit (`qa-j-prod-5-home-0.png`).
- **Fix:** wrap the table in its own scroll container; use compact number formatting.

#### QA-45 · P3 · Every navigation label exists twice; the desktop e2e test fails on it
- **Actual:** at all five widths, the accessibility tree has two buttons each for "الرئيسية", "البيع", "المنتجات", "المخزون" and "التنبيهات". People cards also repeat "تواصل واتساب <name>".
- **Evidence:** [UI] survey; [T] e2e `shell-offline` desktop: strict-mode violation on `button[aria-label="التنبيهات"]`.
- **Links:** UE-16.

#### QA-46 · P3 · Touch targets below 44 px
- **Actual:**

  | Screen | Control | Size |
  |---|---|---|
  | Sales | promo edit/delete icons | 26×26 |
  | People | edit/delete/WhatsApp | 32×32 |
  | People | phone link | 20 px tall |
  | People | "تحصيل" | 32 px tall |
  | Expenses | amount input | 27 px tall |
  | Alerts | "تم" | 34 px |
  | Products | filter chips | 36 px |

- **Evidence:** [UI] survey (360 px).
- **Rule:** AGENTS.md §7 requires ≥ 44 px.

#### QA-47 · P3 · Promotion card titles are nearly invisible
- **Actual:** dark grey text on a near-black card on the Sales screen.
- **Evidence:** `qa-sales-360.png`.

#### QA-48 · P3 · Searching products in English finds nothing
- **Actual:** "pepsi" → 0 results, although catalog items have English names. Arabic variants work (بيبسي/بيبسى).
- **Fix:** include `name_en` in the products search (the sandwich picker already does).

#### QA-49 · P3 · No web app manifest; the app can't be installed
- **Actual:** `/manifest.webmanifest` → 404 on DEV and PROD.

#### QA-50 · P3 · Signup can leave an unusable account
- **Status:** [C] only, not reproduced. The user is created before the store transaction (UE-12).

#### QA-51 · P3 · Sessions never slide, and membership is not re-checked
- **Status:** [C].
- **Details:**
  - The cookie lasts 30 days fixed; the client never calls rotate.
  - A removed member keeps access until expiry (UE-17).

#### QA-52 · P3 · Alert rules
- **Status:** [T]/[C], from earlier audits, not re-reproduced.
- **Details:**
  - Clearance offer can be above the original price (K7).
  - Expiry day uses the server's local day, not Cairo (K8).
  - Weighed goods count as "low" only at ≤ 5 **grams**.

#### QA-53 · P3 · The offline catalog is never downloaded
- **Status:** [C] (UE-15). `syncCatalog` is never called.
- **Also:** `/api/sync/catalog` is public and accepts `limit=999999` (a 300 KB response).

#### QA-54 · P3 · Test-suite problems
- **Integration:** 1 test fails (the K5 clamp test vs the code).
- **e2e:**
  - The desktop `shell-offline` test fails (QA-45).
  - The `sandwich-products` spec failed on both viewports in two runs, timing out on the slow DB. It passed earlier today at the same commit while the server was idle.
  - `auth-screens.spec.ts` writes into the tracked `docs/screens/phase-2/auth-forgot-code.png` on every run. The file was restored after this audit's run.

#### QA-55 · P3 · Products list payload is about 230 KB
- **Actual:**
  - `GET /api/products?filter=all` returns 230 KB: the global catalog merged with the shop's products.
  - It is loaded by Products, and by Sales and Home through other calls.
  - It takes about 2 s per load on DEV.

#### QA-56 · P3 · A client-chosen sale id collides across shops
- **Status:** latent.
- **Actual:**
  - `recordSale` keeps the client's `id` when it is a UUID.
  - Shop B posting shop A's sale id → 500 (primary-key collision).
  - Once QA-01 is fixed, the 500 vs 200 difference would reveal whether an id exists in another shop.
- **Fix:** generate ids on the server, or scope the uniqueness check.

### P4

#### QA-57 · P4 · Offline, the header shows "حسبة" instead of the shop's name
- **Evidence:** `qa-j-prod-7-offline-after-sale.png`.

#### QA-58 · P4 · Signup accepts a 10,000-character owner name
- **Note:** no `max()` on the signup string fields.

#### QA-59 · P4 · An unknown `section` in the People list silently returns "owedToMe"
- **Expected:** 400.

---

## 5. API status

**Endpoint inventory:** 38 route handlers, built from `src/app/api/**/route.ts`. Every endpoint was called without a session, with a forged token, with malformed JSON, with invalid ids and with ids belonging to another shop.

| Endpoint | No auth | Malformed JSON | Bad / unknown id | Other shop's id | Notable |
|---|---|---|---|---|---|
| `/api/auth/signup` | n/a | **500** | n/a | n/a | 409 duplicates OK |
| `/api/auth/login` | n/a | **500** | n/a | n/a | lockout 400 (QA-24) |
| `/api/auth/logout` | 200 (no-op) | — | — | — | — |
| `/api/auth/session` | 200 `data:null` | — | — | — | — |
| `/api/auth/rotate`, `/revoke-other-sessions` | 401 | ignores body → 200 | — | — | cascade (QA-14) |
| `/api/auth/profile` | 401 | **500** | — | — | always 500 (QA-11) |
| `/api/auth/forgot-password/*` | n/a | — | — | — | enumeration (QA-25) |
| `/api/products` | 401 | **500** | hide **500** · unhide **200** | upsert **500** · hide **500** · delete 404 · unhide **200** (no effect) | duplicate name **500** |
| `/api/stock` | 401 | **500** | batch "nope" **500** · unknown 404 | 404 | 10¹² accepted; races |
| `/api/sales` | 401 | 400 | DELETE **500** | DELETE/POST **500** | ordinary POST always **500** |
| `/api/sales/config` | 401 | **500** | — | — | any body resets (QA-21) |
| `/api/sandwiches`, `/[id]`, `/ingredients` | 401 | 400 / 404 | 404 | 404 · sell **500** | correct otherwise |
| `/api/people`, `/[id]`, `/[id]/transactions` | 401 | **500** | **500** | **500** | overpayment (QA-12) |
| `/api/expenses`, `/[id]` | 401 | **500** | **500** | **500** | dates (QA-37) |
| `/api/machines`, `/topup`, `/deduct`, `/adjust` | 401 | **500** | "nope" **500** · unknown 404 | 404 | race (QA-03) |
| `/api/promotions` | 401 | **500** | DELETE **200** | DELETE **200** (no effect) | invalid offers (QA-20) |
| `/api/alerts` | 401 | — | — | — | loop (QA-28) |
| `/api/store/custom-taxonomy` | 401 | **500** | — | — | stores raw HTML (escaped by React) |
| `/api/ai/*` | 401 | **500** | "nope" **500** · unknown 404 | — | 72 s → 500 (QA-29) |
| `/api/sync/catalog` | **200 (public)** | — | — | — | garbage cursor ignored |
| `/api/cron/*` | 401 (wrong secret) | — | — | — | constant-time compare OK |
| `/api/health`, `/ready` | 200 | — | — | — | — |

**Latency (same session, sequential; DEV vs PROD):**

| Endpoint | Size | DEV | PROD |
|---|---|---|---|
| products | 230 KB | 2.29 s | 2.04 s |
| stock | 25 KB | 4.58 s | 2.75 s |
| sales | — | 1.56 s | 1.55 s |
| alerts | — | 1.66 s | 1.51 s |
| machines | — | 1.48 s | 1.51 s |
| expenses | — | 1.33 s | 1.24 s |
| people | — | 1.51 s | 1.46 s |

Error behavior was identical on DEV and PROD.

---

## 6. Database integrity

All queries were read-only (`SET TRANSACTION READ ONLY`). They ran as `hesba_migrator` on Neon `neondb`, with `app.store_id` set and an explicit `store_id` filter. Shop A is `bb7bfc00-2344-4e83-8d4e-604031e3dc08`.

**Stock: the cache, the batches and the ledger disagree (QA-02, QA-05)**

| Product | `stock_levels` | Σ batch remaining | Σ movements |
|---|---|---|---|
| بيبسي تدقيق | **98** | **10,096** | **90** |
| جبنة رومي تدقيق | **1,980** | 2,680 | 2,680 |
| سكر كرتونة / شيبسي كيس / عيش فينو | 5 / 13 / 9 | equal | equal |

- Movement `balance_after_base` values are wrong where requests overlapped. Cheese has 8 rows of `+100 → 2100`.

**Machine ledger contradicts its balance (QA-03)**

- The balance is 70.00.
- The ledger shows +1.00, +99.00, then −30.00 ×5. That sums to −50.00, so this flow should have been rejected.

**Customer ledger (QA-12)**

| Direction | Amounts |
|---|---|
| `owed_to_me` | 10000, 100 ×5, **994399 (inserted by a balance edit)**, 100 (dated 2099-01-01) |
| `i_owe` | 3000, 1000, 1000, 999999 |

- Displayed balance: 0.

**Expenses**

- 10¹⁵ piasters stored.
- `2026-13-45` stored as 2027-02-14.
- A 2099 date accepted.
- 3 duplicate rows of 7.77 from parallel submits.

**Sales**

- 4 sales and 4 lines (all sandwiches).
- Σ sales total = Σ line totals = 60.00.
- Σ line cost = 31.20.
- No sale without lines, and no orphan auto-created products: the failed ordinary sales rolled back completely.
- No negative batches or levels.

**Constraints that held:**

- `chk_sale_lines_exactly_one_target` (it is what blocks QA-01).
- The sandwich cross-store trigger.
- RLS + FORCE on every tenant table checked.

**Policies:** `<table>_migrator_all USING true` on tenant tables (QA-34).

---

## 7. Offline / sync

| Check (PROD build, service worker controlling) | Result |
|---|---|
| App shell and reload offline | PASS |
| Data offline | Served from the SW `apis` cache (NetworkFirst) |
| Offline sale | **Phantom success, never synced** (QA-04) |
| Pending count | Always 0 (QA-17) |
| Sync after reconnect | Nothing is sent; there is no outbox |
| Duplicate sync / retry / backoff / dead letter / ordering | **Not implemented** (no outbox) |
| Logout → offline | Previous shop's data is readable (QA-13) |
| Offline expense | **PARTIAL:** the expense screen loads offline with cached data, but the script did not complete an offline expense submit, so the result is unverified |
| Stale data risk | NetworkFirst with a timeout: on a slow network, cached (stale) API data can be shown silently. Inferred from the Serwist `defaultCache` configuration, not measured |

---

## 8. Security / tenant isolation

| Area | Result |
|---|---|
| Cross-shop read (lists of products, stock, sales, people, sandwiches, promotions, machines) | **No leak** |
| Cross-shop write, delete or sell by id manipulation (about 40 attempts) | **No effect**. Responses were 404, 500 (QA-42) or a false 200 (QA-35) |
| Unauthenticated access to protected endpoints | 401 everywhere expected |
| Public by design | `/api/sync/catalog` (global catalog only) and health |
| Forged token | 401 |
| Session handling | Cascade logout (QA-14), token in body (QA-40), no sliding (QA-51) |
| Brute force | Per-phone lockout works but can be abused (QA-24). Reset code: 5 tries per code and 15 per IP per 15 minutes |
| Enumeration | Forgot-password (QA-25), login timing (QA-38) |
| Headers / CSRF | None (QA-26). No origin check (QA-39) |
| Offline privacy | QA-13 |
| DB roles | `hesba_app` is not BYPASSRLS. `hesba_migrator` has `USING true` policies (QA-34) |

---

## 9. UX / UI

Every screen was checked at **360, 390, 768, 1280 and 1920 px** in DEV, with 12 s of idle time per screen, logging console errors and failed requests.

- **Console errors and failed requests during normal navigation:** none on any screen, except the sale errors of QA-01.
- **Problems found:**
  - Misleading success (QA-01, QA-04).
  - Wrong figures (QA-06, QA-07, QA-08, QA-09).
  - Invalid promotions shown (QA-20, QA-47).
  - Units in English (QA-43).
  - Overflow (QA-44).
  - Duplicate labels (QA-45).
  - Small targets (QA-46).
  - Generic "server error … شغلك محفوظ" for user mistakes (QA-18, QA-19).
- **Worked well:**
  - RTL and `lang=ar` on every screen.
  - No horizontal overflow outside Home.
  - The expense button is disabled while saving (no duplicate from a UI double tap).
  - The sandwich quantity sheet.

---

## 10. Regression risks

- **Fixing QA-01 alone, without QA-10 (void) and QA-09:** undone sales would stay recorded while their stock is added back.
- **Fixing QA-01 while the client still sends `/api/stock` adjust:** stock would be deducted twice.
- **Adding locks (QA-02, QA-03):** deadlocks if lock order differs between the sale, sandwich and adjust paths. Reuse the id-ordered locking of the sandwich path.
- **Fixing QA-08 (cost semantics):** needs a backfill. Valuation figures on Home and Stock, and FEFO movement costs, will all change.
- **Changing the service-worker caching (QA-13):** offline reading of lists will stop working unless it is replaced by real local data (Dexie).
- **QA-14:** loosening reuse detection must keep detecting genuinely stolen rotated tokens.
- **QA-12:** existing fabricated balancing entries in real data need a data review, not just a code fix.
- **QA-06/07:** once Home reads real data, the numbers shown to owners will change sharply. Communicate this.

---

## 11. Recommended fix order

1. **Data corruption:**
   - QA-02 (stock locks).
   - QA-05 (single source of truth and reconciliation).
   - QA-16 decision.
2. **Financial corruption:**
   - QA-01 + QA-10 + QA-09 together (atomic sale + void + honest list).
   - QA-03 (machine balance).
   - QA-12 (people ledger).
   - QA-08 (cost semantics).
   - QA-33.
3. **Security / tenant isolation:**
   - QA-13.
   - QA-14.
   - QA-26.
   - QA-25.
   - QA-24.
   - QA-34.
   - QA-39, QA-40, QA-38.
4. **Broken core flows:**
   - QA-06 + QA-07 (dashboard).
   - QA-11 (profile).
   - QA-23 (duplicate name).
   - QA-20, QA-21.
5. **Synchronization:**
   - QA-04 + QA-17: an outbox (needs an ADR), or explicit online-only writes.
   - QA-27 (`opId` on every write).
6. **API/runtime errors:**
   - QA-18, QA-19, QA-42, QA-35, QA-36, QA-37, QA-15.
   - QA-29.
   - QA-32.
7. **UX:**
   - QA-28.
   - QA-43, QA-44, QA-45, QA-46, QA-47, QA-48.
   - QA-41.
8. **Cosmetic:** QA-57, QA-58, QA-59.

---

## 12. Method, environments and limitations

**Commands and tests run**

| Command / script | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm test` | 328/328 |
| `pnpm test:int` (local Docker Postgres on :5434) | 197 pass, 5 expected-fail, **1 fail** (K5) |
| `pnpm build` (isolated worktree) | pass |
| Built app run with `next start` on :3100 | ran; `next start` warns that standalone output should use `node .next/standalone/server.js` |
| `pnpm test:e2e` (against DEV) | 15 pass, **3 fail**: sandwich spec ×2 (timeouts), desktop shell-offline (QA-45) |
| Sandwich spec rerun | 2 fail again |
| `qa_api.py` | about 300 requests: auth, every endpoint unauthenticated / malformed / bad id / cross-tenant, validation and boundaries, 6 race scenarios, idempotency |
| `qa_auth2.py` | session cascade and login lockout |
| `qa-survey.cjs` | 8 screens × 5 widths: console, network, request loops, overflow, touch targets, duplicate labels, screenshots |
| `qa-journey.cjs` (PROD) | API-seeded shop, then UI sale (double tap), sandwich via the quantity sheet, expense, dashboard, offline sale / expense / reload, reconnect, logout + offline cache check |
| Read-only SQL checks | via Prisma with `SET TRANSACTION READ ONLY` |
| HTTP checks | `curl` for headers, CSRF and latency |

Scripts, logs and screenshots are in the session scratchpad; they are not committed.

**Browsers:** Playwright Chromium (headless). Mobile emulation (touch, `isMobile`) at 360/390; desktop at 768/1280/1920. Locale `ar-EG`.

**Database:** remote Neon `neondb` (dev), used by both DEV and PROD servers. Integration tests used the local Docker Postgres.

**Test data created on the dev database:**

- About 8 test shops (`qa-*@hesba.test`), with products, stock, sales, people, expenses, machines and promotions.
- One shop holds deliberately absurd values (10¹² units, 10¹⁵ amounts).

Nothing outside these test shops was modified. No reset, drop or delete was run.

**Limitations and untested areas:**

- **Not tested (not implemented):**
  - Passkey, PIN and magic-link login.
  - Returns, credit sale, multi-item cart, discounts.
  - Purchase recording.
  - The outbox (retry, backoff, ordering, conflict handling and dead letter).
- **Not tested end to end:**
  - Password reset to completion: the email provider fails in DEV.
  - Expired-session behavior: code-read only. The 30-day expiry check exists.
- **Not done (time):** server shutdown mid-request and network drop *during* a request. Offline was tested by toggling between requests. Killing the server mid-checkout was not done.
- **Offline expense submission:** inconclusive (see §7).
- **Browsers:** no real phones, Safari or Firefox. All testing used Chromium, so iOS PWA behavior is untested.
- **Single sample:** the timing leak (QA-38) and latency numbers are from one machine and network, against a remote database.
- **AI:** one live chat call only (the provider was overloaded). Answer quality was not assessed.
- **Code-only items:** QA-07, QA-33, QA-50, QA-51 and QA-52 are confirmed from code, not reproduced. They are tagged [C].
