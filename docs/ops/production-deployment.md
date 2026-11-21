# Production deployment

The steps to take Hesba from an empty production account to a running app. Nothing here
has been run against production yet: each step needs the owner's go-ahead. Pair it with
`production-checklist.md` (what must be true before real shops) and `rollback.md`.

## 0. Decisions to make first

| Decision | Why it matters |
| --- | --- |
| Hosting plan that **allows commercial use** (e.g. Vercel Pro, or a VM with Docker) | Vercel Hobby forbids paid products (docs/07-ops.md, Part 2) |
| The production domain (e.g. `app.hesba.app`) | `HESBA_APP_ORIGIN` must equal it exactly: the same-origin guard refuses writes from any other host |
| Neon plan and region (Frankfurt, as staging) | History window: Free = 6 h, paid = up to 7 days |
| Where the daily encrypted backups go | backup-restore.md |

## 1. Database: a new Neon project (Postgres 18)

Create a **separate** project for production, never a branch of dev. As `neondb_owner` (SQL
editor), create the three roles with strong, unique passwords. Do NOT use
`scripts/sql/00-roles.sql` as is: its passwords are the local ones.

```sql
CREATE ROLE hesba_migrator LOGIN PASSWORD '<strong-1>' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE hesba_app      LOGIN PASSWORD '<strong-2>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE hesba_service  LOGIN PASSWORD '<strong-3>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO hesba_migrator;
GRANT USAGE ON SCHEMA public TO hesba_app, hesba_service;
```

The app must never connect as `neondb_owner` (it bypasses RLS). Keep that URL only for backups.

## 2. Secrets (deployment environment, never in git)

| Variable | Value |
| --- | --- |
| `HESBA_DATABASE_URL` | **Pooled** host, role `hesba_app` (`?sslmode=require`) |
| `HESBA_DIRECT_URL` | **Direct** host, role `hesba_migrator`. Used by `prisma migrate deploy` only, not by the running app |
| `HESBA_SERVICE_DATABASE_URL` | Pooled, role `hesba_service` (catalog-promotion cron only) |
| `HESBA_SESSION_SECRET` | 64+ random characters (`openssl rand -base64 48`) |
| `HESBA_CRON_SECRET` | 32+ random characters |
| `HESBA_CARD_KEY` | 32 bytes as 64 hex characters (`openssl rand -hex 32`). **Back it up separately**: losing it makes stored card serials unreadable |
| `HESBA_APP_ORIGIN` | `https://<your-domain>`, exactly |
| `HESBA_RENEWAL_WHATSAPP` / `_VODAFONE_CASH` / `_INSTAPAY` | The real contact details shown on the subscription screen |
| `HESBA_AI_SCANNER_API_KEY`, `HESBA_AI_ASSISTANT_API_KEY` | Optional. Without keys the scanner uses the mock and the assistant runs in private mode |
| `HESBA_AI_ASSISTANT_DATA_SHARING` | `none` unless the provider tier contractually excludes training (ADR-0030) |
| `HESBA_SENTRY_DSN` | Recommended (error reporting) |
| `LOG_LEVEL` | `info` |

`RESEND_*` is not needed: there is no e-mail flow. `NEXT_PUBLIC_*` variables: none exist,
and none may hold a secret.

## 3. Schema

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
HESBA_DIRECT_URL='<migrator direct URL>' HESBA_DATABASE_URL='<app pooled URL>' pnpm exec prisma migrate deploy
HESBA_DIRECT_URL='…' HESBA_DATABASE_URL='…' pnpm exec prisma migrate status   # → "Database schema is up to date!"
```

This was proven on a fresh Postgres 18 on 2026-11-21: the roles plus `migrate deploy` give the
complete schema, with nothing hidden, and `prisma migrate diff` against `schema.prisma` shows
only the one documented difference (tests/integration/schema-drift.spec.ts).

Then, as `hesba_migrator`, run `scripts/sql/10-service-role-grants.sql` (re-runnable) for the
catalog-promotion cron.

## 4. Global catalog (no shop data)

Choose one, and do it once:

- **Import the curated CSVs:** `HESBA_DIRECT_URL=… pnpm catalog:import data/catalog/egyptian-market`
  (try `--dry-run` first), and `pnpm exec tsx scripts/seed-telecom-services.ts` for telecom
  services.
- **Copy the dev catalog with its IDs.** Use the global tables only: `brands`,
  `global_products`, `global_variants`, `catalog_candidates`, `prepaid_products`,
  `bill_providers`, `commission_rules`. Take them from a verified backup (backup-restore.md),
  never a shop table.

## 5. The first admin

After the owner's account exists (sign up in the app), as the migrator:

```sql
INSERT INTO platform_admins (user_id) SELECT id FROM users WHERE phone = '+2010XXXXXXXX';
```

## 6. Deploy the app

- `pnpm build` (`next build --webpack`, `output: "standalone"`, Serwist service worker). Deploy
  on the commercial hosting plan.
- **Build where no `.env` file exists**: CI, Vercel, or the Dockerfile. `.dockerignore` already
  excludes `.env` and `.env*.local`. Next copies a project-root `.env` into
  `.next/standalone/`, so a standalone folder built on a developer machine and shipped
  elsewhere would carry that machine's secrets.
- HTTPS only. Cookies are `Secure` + `HttpOnly` + `SameSite=Lax` in production builds, and HSTS
  is sent (`HESBA_HSTS_INCLUDE_SUBDOMAINS=1` only once every subdomain serves HTTPS).
- No CORS: the API serves its own origin only.

## 7. Scheduled jobs (no scheduler is bundled)

Call these with `Authorization: Bearer $HESBA_CRON_SECRET` from Vercel Cron, GitHub Actions
`schedule`, or any external scheduler:

| Endpoint | Suggested schedule | Without it |
| --- | --- | --- |
| `POST /api/cron/ai-cleanup` | Daily, 03:00 Cairo | Old AI conversations are not pruned |
| `POST /api/cron/catalog-promotion` | Daily | Community products are not promoted to the global catalog |
| Backup job (backup-restore.md) | Daily | **No independent backup** |

Subscriptions need no cron: expiry is decided on every request by the server clock.

## 8. Verify (smoke test, ~10 minutes)

1. `GET /api/health` → `ok`; `GET /api/health/ready` → `ready`, `database: connected`.
2. In a private window, `/` shows the login screen; DevTools shows no request but
   `/api/auth/session`.
3. Sign up (no e-mail, either mode) → the app opens; reload → still signed in; log out; log in.
4. `prisma migrate status` → up to date.
5. Error reporting: a forced test error appears in Sentry with its `request_id`.

## Every later release

1. CI green (types, lint, unit, integration, E2E).
2. **Backup** (backup-restore.md, method A).
3. `prisma migrate deploy` (if the release has migrations), then `migrate status`.
4. Deploy the app, then run the smoke test.
5. Problem → rollback.md.
