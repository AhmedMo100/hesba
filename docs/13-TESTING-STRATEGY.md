# Hesba — Testing Strategy and Merge Conditions

> A test that passes by mistake is more dangerous than no test. **Any test that hides RLS, Postgres, or Sync behind a mock = rejected.**
> Priorities: **inventory and money first**, then sync, then isolation, then the UI.

---

## 1. The Pyramids (by priority)
| Level | Tool | Covers | Level of attention |
|---|---|---|---|
| **Unit (domain)** | Vitest | FEFO, unit conversion, money, profit calculation, Arabic normalization, alert thresholds | Very high |
| **Property-based** | fast-check | Inventory, void, idempotency, rebase | Very high |
| **Integration (real DB)** | Vitest + Testcontainers (Postgres) | Handlers/Actions + RLS + Sync + Jobs + Migrations | High |
| **Contract** | Shared zod | Client ↔ server (same schemas) | Medium |
| **E2E** | Playwright | User journeys + offline | Medium |
| **Offline chaos** | Playwright (network control) | Cut mid-push, repeated op, two devices | High |
| **Security** | Vitest/CI | cross-tenant, identity leak, CSRF, webhooks | Mandatory |
| **Load** | k6 | Sync storm, evening peak | Before Beta and every growth stage |
| **Visual/Device** | Manual + Playwright screenshots | 320/360/390, light/dark, low-end Android | Before Alpha |

## 2. Inventory and Money Tests (the most critical)

### Property tests (fast-check)
1. **Quantity conservation:** For any random sequence of (`stock.add`, `sale.create`, `sale.void`, `stock.waste`), `stock_levels.qty = SUM(movements)` and `batch.remaining = qty + SUM(batch movements)`.
2. **void reverses:** `sale.create` then `sale.void` = exactly the original state (batches and balance).
3. **FEFO:** A sale takes from the nearest expiry first, items without expiry last, and on a tie the oldest received.
4. **Negative:** Selling more than the balance = negative balance + `negative=true` + no invariant broken.
5. **idempotency:** Repeating the same `op_id` any number of times = a single effect.
6. **Ordering:** Swapping the order of independent operations (different products) does not change the final result.
7. **Money:** No floats; `amount = round(qty × price)` per the single rounding rule in `domain/money.ts`, and the sum of the lines = `sales.total_minor`.
8. **Units:** A carton = `pack_qty` pieces, weight in grams, conversions are mathematically correct.
9. **rebase:** A pending sale + a pull containing a batch change = the final balance is correct (`10` section 5).

### Unit tests (example cases)
- Alert thresholds: weight `< 3000 g` = running low, carton `< 2×pack_qty`, generic `< 10`, `<= 0` = out of stock (`09` section 8).
- Near expiry: expiry within 7 days or less, batches with `remaining > 0` only.
- Profit = sales − cost of goods sold − expenses, and voided sales are excluded.
- Weight sale: 350 g × 320 EGP/kg = 112 EGP with the specified rounding.
- Arabic normalization (30+ examples): hamzas, ya/alef maqsura, ta marbuta, diacritics, Eastern Arabic numerals.

## 3. Sync Tests (Integration + Chaos)
Everything in `10-SYNC-PROTOCOL.md` section 9, plus:
- **Two simultaneous devices** on the same store: overlapping operations, the final state is identical on both devices and the server.
- **Long offline period:** 500+ pending operations are sent in batches without duplication.
- **A cut at every step:** before sending, during, after the response but before the local save (simulated with Playwright route abort).
- **A rejected operation** in the middle of a batch does not block the rest and appears in "needs review".
- **Old Service Worker:** A client on the previous `schema_v` after a new deployment keeps syncing.
- **Limits:** 429/503/401/403/409 all produce the correct client behavior (the queue is preserved).
- **No polling:** A test that no periodic requests occur without an event (counts requests during minutes of idleness).

## 4. Isolation and Security Tests
`12` section 10. The most important: **cross-tenant for every Endpoint**, RLS enabled on every table that has `store_id`, **no store identity leak** in the catalog, CSRF on `/api/sync`, forged webhook.

## 5. Catalog and Suggestions Tests (`06`)
Normalization, duplicate prevention (concurrency: two stores with the same product at the same instant = one candidate), RLS on `catalog_suggestions`, the daily cap, offline acceptance, **the price is not copied**, automatic promotion at N, it never returns `submitted_by_store`.

## 6. UI Tests (E2E — Playwright)
Mandatory paths (light/dark, 360px):
1. Sign-up (two steps + test OTP) → login.
2. Add a product (from the catalog + custom).
3. Add stock (expiry + supplier + on credit).
4. **Sell without internet** (piece, carton, weight) + undo → internet returns → syncs.
5. Expense + delete with undo.
6. People (owed to you / you owe / supplier).
7. Alerts (out of stock / near / expiry) + catalog suggestion (add).
8. AI: 5 messages then lockout.
9. Subscription expiry = read-only.
10. **No horizontal scroll** on 320/360/390.
11. App update (new version) with a pending queue.
**Tests use `exact:true` in `getByRole(name)` (because it is a substring match) and `.last()` for the toast.**

## 7. Performance Tests (Load — k6)
Scenarios: (a) evening peak (b) **sync storm** (hundreds of devices coming back at once) (c) bootstrap for new devices (d) the catalog (ETag/Cache). We record: p95/p99, error rate, connections, DB CPU. **The targets are in `01` section 1 and are adjusted after measurement.**

## 8. CI Gates (merge condition)
```
1. lint (eslint + import boundaries)        6. integration + RLS + cross-tenant (Testcontainers)
2. typecheck (tsc --noEmit)               7. build (next build)
3. unit + property tests                  8. Docker build (standalone) — for portability
4. audit (pnpm audit + Dependabot)        9. bundle size budget
5. security (identity leakage, CSRF...)       10. E2E (on main and before release)
```
**Failure of any gate = merge forbidden.** The heavy E2E may run only on `main` and before deployment to save time.

## 9. Test Data
- **Seeds:** `scripts/seed.ts` realistic test data (from the demo: products with Arabic names, weight/carton, batches with varied expiry dates, expenses, people, suppliers). A fixed seed (`mulberry`) for repeatability.
- **Factories** for Handlers/Sync.
- **Testcontainers:** A real Postgres with the same version and extensions (`pg_trgm`) and the same DB roles (`hesba_app`, not superuser) — **otherwise the RLS test passes by mistake.**
- **Time:** An injectable `Clock` (no direct `Date.now()` in the domain) to test expiry and periods.

## 10. Device and Browser Matrix
| Category | Tested on |
|---|---|
| Low-end/old Android | Chrome + Samsung Internet (real device) — the most important category |
| Modern Android | Chrome |
| iPhone | Safari (PWA install + offline + IndexedDB) |
| Screens | 320 / 360 / 390 / 430 / 768 / 1280 |
| Theme | Light + dark + automatic |
| Network | Offline, Slow 3G, intermittent |

## 11. Definition of Tested
- The test actually ran and passed, **and the test itself fails if the code is broken** (try deliberately breaking the code once).
- It covers the happy path + at least two failure cases.
- No `skip`/`only` left behind.
- The Agent reports the actual result (number of tests, which failed), **not "all good"**.
