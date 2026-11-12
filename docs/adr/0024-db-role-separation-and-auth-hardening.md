# ADR-0024: No tenant bypass for the migrator; a narrow service role; session, lockout, recovery and header hardening

- **Status:** Proposed
- **Date:** 2026-11-12
- **Fixes:** audit QA-14, QA-24, QA-25, QA-26, QA-34 (`docs/QA/FULL-SYSTEM-AUDIT.md`)

## Context (verified in code and on the local database)

- **QA-34:** `hesba_app` is correctly configured: not superuser, no BYPASSRLS, owns nothing, belongs to no role. However:
  - 30 tables carried a `<table>_migrator_all` policy (`USING true`) for `hesba_migrator`, the owner of every table. With that policy, FORCE RLS did not stop the migrator from seeing every shop.
  - The catalog-promotion cron ran at request time on that connection (`systemPrisma`, from `HESBA_DIRECT_URL`).
- **QA-14:** any revoked token was treated as stolen, and the code revoked every session of the user. Logout, "sign out other devices" and rotation all revoke, so an old token logged the owner out everywhere.
- **QA-24:** the login limiter counted every attempt, including successful ones, and answered 400.
- **QA-25:** the forgot-password request surfaced the email provider's failure (503) only for registered emails.
- **QA-26:** no security headers were sent.

## Decision

### QA-34: roles

1. **No migrator bypass on tenant tables.** Migration `20261113000000_remove_migrator_tenant_bypass` drops every `*_migrator_all` policy on tables with a `store_id`, and on `stores`.
   - The migrator now sees a shop's rows only with `app.store_id` set, like the app.
   - Global catalog tables keep their migrator policy, because importing the catalog is the migrator's job.
2. **Cross-store migrations lift FORCE only inside their own transaction.** A future migration that must touch every shop runs `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` and `… FORCE …` inside that migration. The elevation exists only in the migration context.
3. **`hesba_service` is the only runtime role allowed across shops, and only the catalog-promotion cron uses it** (`HESBA_SERVICE_DATABASE_URL`).
   - **Role:** not superuser, no BYPASSRLS, no memberships.
   - **Grants, exactly what the job needs:**
     - **read:** `stores`, `candidate_adoptions`;
     - **write:** `catalog_notifications`;
     - **update one column each:** `store_products.global_product_id`, `store_variants.global_variant_id`;
     - **global catalog tables:** read and write.
   - **Never:** sales, stock, money, people, sessions or users; no DELETE anywhere.
   - **Creating it needs a superuser.** It is created by `scripts/sql/00-roles.sql` locally and in CI. On Neon and production it is an authorized manual step, followed by `scripts/sql/10-service-role-grants.sql`.
   - **The cron refuses to run** (503) when the role isn't configured, or when its connection is not `hesba_service`. It never falls back to the migrator.
4. **The migrator is never used at runtime.** `systemPrisma` is removed.
5. **Tests:** integration fixtures (seed, inspect, clean up) use a test-only admin connection, `HESBA_TEST_ADMIN_URL`. The code under test and every isolation check use the real roles; see `db-roles-security.spec.ts`.

### QA-14: sessions

- A revoked token is simply refused (401); no other session is touched.
- **Stolen-token detection is limited to rotated tokens.** A rotated token (one that has a successor) used again after a 30-second grace period revokes only its own rotation chain, on that device.
- Rotation is atomic: one token produces one successor.

### QA-24: login lockout

- **Only failures count:** 5 per phone and 15 per IP in 15 minutes, the thresholds already in the code. A success releases its slot and clears the phone's counter.
- **Concurrency:** the check and the reservation happen in one synchronous step, so parallel guesses can't exceed the limit.
- A locked request gets **429** with `Retry-After`.
- Unknown phones count exactly like known ones, so the lockout doesn't reveal which phones have accounts.
- Logs no longer contain phone numbers.

### QA-25: password recovery

- **One identical answer** (200 and the same body) for registered and unregistered emails, including when the email provider fails.
- **The email is sent after the response** (Next `after()`). A failed send is logged without the address and invalidates the code.
- **Code security is unchanged:** HMAC-hashed, 10 minutes, single use, 5 attempts, bound to its user. The rate limits (per email and per IP) apply identically to every email.
- **Remaining timing difference:** a registered email does one extra lookup and one insert before the response. This is not proven indistinguishable, only small.

### QA-26: headers

`next.config.ts` `headers()` applies one policy, `src/server/config/security-headers.ts`, to every path: pages, redirects, API successes and errors, and static files.

- **Content-Security-Policy:**
  - `default-src 'self'`.
  - Scripts from this origin, with `'unsafe-inline'`. The pages are prerendered, so per-request nonces aren't available. `'unsafe-eval'` is allowed in development only.
  - Styles from this origin, plus inline.
  - Images from this origin, `data:` and `blob:`. Fonts and connections from this origin only.
  - `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, and `upgrade-insecure-requests` in production.
- **Other headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (microphone allowed for this origin only, for voice search), and `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`.
- **HSTS:** `max-age=31536000`, production only. `includeSubDomains` is opt-in (`HESBA_HSTS_INCLUDE_SUBDOMAINS=1`) until every subdomain is confirmed to serve HTTPS. No `preload`.
- `X-Powered-By` is removed.

## Consequences and remaining risks

- **The catalog-promotion cron is off on Neon and production** until the database owner creates `hesba_service` and sets `HESBA_SERVICE_DATABASE_URL`. This needs your authorization; nothing was changed there.
- **`script-src 'unsafe-inline'` remains.** Moving to nonces needs dynamic rendering of every page; that is a separate decision.
- **The login and recovery limiters live in process memory.** With several server instances, each counts on its own. A shared store is out of scope.
- **`hesba_app` still has `CREATE` on the `public` schema** in the local database (granted outside the migrations). It cannot bypass RLS, but it is unnecessary; recommend revoking it as an infrastructure step.
- **Passkeys and the local PIN aren't implemented.** Login is phone + password, and it is unchanged.
