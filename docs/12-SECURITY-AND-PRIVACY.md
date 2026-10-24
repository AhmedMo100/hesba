# Hesba — Security and Privacy

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
| 5 | SQL injection | Leak/corruption | Drizzle with parameters only; building SQL from inputs is forbidden |
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
