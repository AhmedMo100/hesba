# حسبة (Hesba) — Quality: Security, Privacy & Testing Strategy

> Consolidated quality documentation combining:
> - **Part 1: Security and Privacy** (formerly `docs/06-quality.md`)
> - **Part 2: Testing Strategy and Merge Conditions** (formerly `docs/06-quality.md`)

---

# Part 1: Security and Privacy
> Source: formerly `docs/06-quality.md`

> Security here means **requirements that are implemented and tested**, not good intentions. Any feature that touches identity, sessions, OTP, subscriptions, or the shared catalog = read this file first.
> **Legal:** Points marked ⚖️ must be reviewed by a **lawyer** before production. I am not a substitute for legal advice.

---

## 1. Threat Model (brief)
| # | Threat | Impact | Primary control |
|---|---|---|---|
| 1 | One store sees/modifies another store's data | Legal disaster and reputation damage | Mandatory RLS + cross-tenant test in CI + `withTenant()` |
| 2 | Session/account theft | Access to the store's data | httpOnly+Secure+SameSite cookie, session rotation, device binding, server-side revocation |
| 3 | Brute-force / OTP abuse | SMS cost + account compromise | Limits per number/IP/device + escalating delay + CAPTCHA when suspicious |
| 4 | CSRF on `/api/sync/*` | Forged operations | `SameSite` + `Origin` check + `X-Hesba-Client` |
| 5 | SQL injection | Leak/corruption | Prisma with parameters only; building SQL from inputs is forbidden |
| 6 | XSS | Session theft | React escaping, CSP, no `dangerouslySetInnerHTML` with user input, sanitize catalog text |
| 7 | Leak of a store's identity/prices through the shared catalog | Privacy | The API never returns `submitted_by_store`; prices are never shared + automated test |
| 8 | Catalog abuse (spam/offensive content) | Reputation | Filters + daily cap + reports + review (06) |
| 9 | Quota/cost exhaustion (SMS, AI, egress) | Financial | Daily limits + budget + automatic lockout + alerts |
| 10 | Secret leakage | Compromise | Secret store, no secrets in code/logs, periodic rotation |
| 11 | Compromised dependencies | Supply chain | `pnpm audit` + Dependabot + lockfile + review of additions |
| 12 | Data loss/corruption | Trust | Encrypted off-site backup + tested restore |
| 13 | Unauthorized subscription extension | Wrong subscription state or revenue loss | Manual activation restricted to platform_admin + mandatory audit_log entry |
| 14 | Device lost/stolen | Local access | Optional PIN + server-side session revocation + no extra sensitive data stored locally |

## 2. Identity and Sessions
- **Password:** Argon2id (`@node-rs/argon2`). Parameters (memory/iterations) are tuned by measuring timing on the chosen hosting (goal: a reasonable time that does not exhaust the CPU). Storing/logging a password is **forbidden**.
- **OTP:** A short numeric code, stored **hashed**, short validity, limited attempts, consumed once. Send limits per number/IP/device and per day. **The actual values are fixed in `constants.ts` and are set together with the SMS provider** (no invented numbers here).
- **Session:** An `httpOnly; Secure; SameSite=Lax` cookie carrying a random identifier; what is stored in the DB is the **hash** of the identifier (`sessions.id_hash`). **Rotation** on periodic use + detecting reuse of an old identifier = revoke all of the device's sessions. Absolute expiry + idle expiry. Server-side revocation (logout / password change).
- **Offline:** An expired session **does not stop local selling**; authentication happens at sync time. Local account data = the minimum.
- **Password recovery:** OTP to the mobile number (same limits).
- **Roles:** `owner` / `cashier` (V1.1). Permissions are always checked on the server (not only in the UI).
- **Admin platform (`platform_admin`):** A separate role, 2FA (decision in `15`), every operation goes to `audit_log`.

## 3. Store Isolation (the most important)
1. Every table has `store_id` + RLS (`09`). `FORCE ROW LEVEL SECURITY`.
2. The application user is **not an owner, not a superuser, and not BYPASSRLS**. Migrations run as a different user.
3. Every query runs inside `withTenant(storeId, userId, fn)`; `set_config(…, true)` is local to the transaction.
4. Tables without RLS are on a specific list (`09` section 9) and are accessible only from the `hesba_service` role.
5. **Mandatory CI test:** two stores; every Endpoint/Action/Handler is tried with a wrong `store_id` and the build fails if it succeeds. Plus a test that RLS is actually enabled on every table that has `store_id` (reads the catalog).
6. Pooled-connection test: `set_config` does not leak between requests.

## 4. Web Security
- **Headers:** Strict CSP (no unauthorized inline, `nonce`), HSTS (after stabilization), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`.
- **CSRF:** Server Actions have Next's built-in protection; `/api/sync/*` and `/api/cron/*`: check `Origin`/secret depending on the type.
- **Rate limiting:** On Cloudflare (WAF) + in the application (OTP, login, sync, AI, catalog). Limits are in `constants.ts`.
- **Inputs:** zod at every system boundary (Actions, Handlers). Extra fields are rejected (`strict`).
- **Outputs:** React escapes output. `dangerouslySetInnerHTML` with user content is forbidden. Catalog text is sanitized (length, characters, no HTML).
- **CORS:** Closed (same origin).
- **Files:** V1 has no image upload. If added: verify type/size, store outside the origin, random names.

## 5. Secrets and Configuration
- All secrets live in the hosting Secret store (not Git, not a committed `.env`). `.env.example` contains dummy values.
- `src/server/config/env.ts` (zod): the application **fails at startup** if a secret is missing or weak.
- Different secrets per environment. Periodic rotation and rotation on any suspicion. `HESBA_CRON_SECRET` and `HESBA_SESSION_SECRET` are long random values.
- The backup encryption key is kept separate from the backup location.

## 6. Privacy and Personal Data ⚖️
- **Data we collect:** The store owner's name, mobile number, email (optional), store data, operational data (products, sales, expenses, people with their names and numbers).
- **Third-party data:** Names and numbers of the store's customers/suppliers/workers. The store is the controller of their data; the terms make this clear ⚖️.
- **Personal Data Protection Law No. 151 of 2020:** A lawyer must review: consent, purpose, retention period, transferring data outside Egypt (hosting location — `05`), user rights, breach notification, and whether any registration/licensing is required ⚖️. **The hosting decision is pending this answer.**
- **Minimization:** Collect only what we need. No advertising tracking. No selling/sharing of data.
- **Shared catalog:** Only the **product definition** is shared, **without the store's identity and without prices/stock/sales**. The store can disable sharing and receiving. Consent is in the terms ⚖️ (06).
- **User rights:** Export their data (CSV/JSON) and delete the account (a Job, with a short grace period to undo) ⚖️. Deletion covers backups according to a published retention policy.
- **Retention:** `sync_ops` older than X days are cleaned up. `otp_codes` are cleaned up. `audit_log` is kept for a defined period. Values are fixed in `constants.ts` and are set with the lawyer ⚖️.
- **Logs:** `request_id` and `store_id` only. **Forbidden:** mobile numbers, names, passwords, OTPs, tokens, operation content.
- **Sentry:** `beforeSend` strips sensitive fields; no session replay on sensitive screens.
- **AI:** We do not send people's personal data (names/numbers) to the LLM. Only aggregated results are sent. The provider and its data policy are to be reviewed ⚖️.

## 7. Backup and Restore
- A daily encrypted backup (age/GPG) to separate off-site storage (`05` R4) + paid PITR when needed.
- **Restore test** on a test database monthly during Alpha, then quarterly. An untested restore = no backup.
- Targets: RPO ≤ 5 minutes, RTO ≤ 2 hours (with PITR/paid backups; on the free tier the targets are weaker — document them).
- No real data in Dev/Staging environments (test data only).

## 8. Monitoring and Incident Response
- Alerts on: 5xx error rate, OTP failures, unusual 401s, many 429s, AI/SMS consumption, backup failure, job queue depth, storage growth.
- `audit_log` for sensitive operations: login/logout, password change, account deletion, data export, admin operations, subscription change.
- **Incident plan (Runbook):** detect → contain (maintenance flag / revoke sessions / rotate secrets) → assess → notify (users and authorities as required by law ⚖️) → fix → post-incident review.
- Kill switch: `flags` (maintenance, disable suggestions, disable AI, disable registration).

## 9. Subscriptions and Manual Renewal
- **No card data is stored**: Hesba stores no card data and does not process online transactions.
- **Renewal confirmation**: Subscription renewal confirmation is a WhatsApp message sent to the business contact after manual transfer (Vodafone Cash or InstaPay).
- **Manual activation**: The owner activates subscriptions manually upon reviewing the transfer.
- **Audit logging**: Every manual change is logged in `audit_log` (who, when, store, previous period end, new period end).
- **Read-only on expiry**: Subscription status is determined by the server only. Subscription expiry = **read-only**, **never deletes store data**.

## 10. Security Tests (mandatory in CI)
1. Cross-tenant on every Endpoint/Action/Handler.
2. RLS enabled on every table that has `store_id`.
3. No store identity leak in any catalog-related response.
4. OTP/login brute-force is stopped by the limits.
5. Reuse of an old session identifier = revocation.
6. CSRF: `/api/sync/push` without `Origin`/`X-Hesba-Client` = rejected.
7. Manual subscription change without audit log = rejected.
8. Logs contain no sensitive fields (test on a sample).
9. `pnpm audit` with no critical vulnerabilities.
10. CSP is active (no unauthorized inline) in E2E.

## 11. Before Launch
- [ ] Pentest (internal + preferably external) and fix the findings (`04` P5-Q-01).
- [ ] Lawyer review ⚖️ (terms, privacy, hosting, catalog).
- [ ] Backup restore test.
- [ ] Rotate all secrets and separate production environments.
- [ ] Enable alerts and runbooks.
- [ ] Account deletion page and data export working.

---

# Part 2: Testing Strategy and Merge Conditions
> Source: formerly `docs/06-quality.md`

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
| **Security** | Vitest/CI | cross-tenant, identity leak, CSRF, audit log | Mandatory |
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
`12` section 10. The most important: **cross-tenant for every Endpoint**, RLS enabled on every table that has `store_id`, **no store identity leak** in the catalog, CSRF on `/api/sync`, unauthorized subscription activation.

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
