# Production readiness checklist

State on 2026-11-21, branch `feat/operating-modes-subscriptions` (PR #42). Every **Ready** row
was verified by a test or a run that actually happened. Statuses:

- **Ready**: verified.
- **Needs configuration**: the owner must set something up outside the code.
- **Blocked**: prevents launch until solved.
- **Not tested**: not verified yet.

## Data and database

| Item | Status | Evidence |
| --- | --- | --- |
| A new production database is built from migrations alone (besides creating the roles) | Ready | Fresh Postgres 18: `00-roles.sql` + `migrate deploy` → 36 migrations, schema complete |
| `schema.prisma` ⇄ migrations drift | Ready | Only the documented composite FK remains; `schema-drift.spec.ts` guards it |
| Neon dev ⇄ migrations | Ready | Schema dump identical to a fresh build, except the missing `hesba_service` role (config) |
| Money as integer piasters, no floats | Ready | `BigInt` everywhere; `Decimal` only for sizes and fee percentages |
| Tenant isolation (RLS on every shop table, app role without bypass) | Ready | `cross-tenant`, `db-roles-security` and FORCE RLS invariant tests |
| Production Neon project, roles with real passwords | Needs configuration | production-deployment.md §1 |
| `hesba_service` role + grants (catalog-promotion cron) | Needs configuration | Missing on Neon dev too |
| Daily encrypted backups + monthly restore drill | Needs configuration, **launch-blocking** | No job exists. backup-restore.md (a migrator `pg_dump` fails under RLS) |

## Money, stock and business rules

| Item | Status | Evidence |
| --- | --- | --- |
| Cash and credit sales, collections, supplier payments, returns, voids, drawer | Ready | Integration suite (538 tests) |
| Concurrent sales and stock (no oversell, exact levels) | Ready | `sales-concurrency` (9 cases); measured 30 + 30 concurrent → exact |
| Concurrent returns (no over-return), supplier payments (no overpay) | Ready | `financial-concurrency.spec.ts` (new) |
| Idempotency (same `opId` → once), including concurrent repeats | Ready | Machines, checkout, returns, payments, expenses, collections |
| Daily totals (إدارة المحل) in reports **and** in the AI assistant | Ready | Fixed in the assistant; test in `operating-modes-subscriptions` |

## Auth and security

| Item | Status | Evidence |
| --- | --- | --- |
| Sign-up without e-mail, double tap = one account, Arabic errors | Ready | `password-reset-admin.spec.ts`, browser scenario A (mobile + desktop) |
| Login, reload, logout, wrong password (no session) | Ready | Integration + browser scenario B |
| Nothing of the app or its APIs without a confirmed session | Ready | Browser scenario F (also with a stale cookie): only `/api/auth/session` |
| Manual reset: hash only, all sessions revoked, forced change, temporary password dies | Ready | Integration (10 tests) + browser scenario E with the real CLI |
| Mode and subscription changes only by the owner / by Hesba (trigger, strict body) | Ready | `operating-modes-subscriptions` (20 tests) |
| Same-origin guard on writes, secure cookies in production, security headers, CSP | Ready | `auth-security`, `security-headers` E2E |
| No secrets in git or in client bundles | Ready | `git grep` scan; production bundle scan (2.2 MB) clean |
| Logs redact passwords, phones, names, tokens | Ready | `logger.ts` redaction list; reset tool prints the temporary password to the terminal only |
| Dependencies | Ready | Next 16.4.6 (7 advisories fixed). 2 moderate, build-time only (Sentry bundler plugin) |
| Login rate limits are per server instance (in memory) | Risk | On several serverless instances the limit applies per instance. Argon2id and the 12+ character policy keep online guessing impractical. A database-backed limiter is the fix when traffic grows |

## Offline and sync

| Item | Status | Evidence |
| --- | --- | --- |
| Outbox: durable, retried with the same `opId`, never sent twice, per shop | Ready | `sale-outbox` unit (17), `offline-sales` E2E |
| Account switch on one device, subscription over while offline (kept, not deleted) | Ready | Unit tests; 402 keeps queued sales |
| Shell works offline after a real signed-in visit | Ready | `shell-offline` E2E (updated to a real session) |

## Performance (local production build, local Postgres: indicative, not Neon)

| Path, concurrent | p95 | Target (docs/01) |
| --- | --- | --- |
| Session ×50 / reports ×50 / stock ×50 | 154 / 245 / 138 ms | ≤ 300 ms ✅ |
| Products list ×50 (full catalog) | 480 ms | ≤ 300 ms ⚠️ (screens can ask `scope=store`) |
| Collection ×30 / stock-in ×30 | 189 / 291 ms | ≤ 500 ms ✅ |
| 30 sales of the SAME item at once | 830 ms | ≤ 500 ms ⚠️ (row lock that keeps stock exact; not a real shop pattern) |
| Product list burst before the fix | 50 × 500 | **Fixed** (pool starvation), regression test added |
| k6 load test on Neon (sync storm, evening peak) | Not tested | docs/06 §7: required before Beta |
| Catalog-promotion cron with thousands of shops | Not tested | 67 s locally with 2,597 test shops: check the hosting time limit before scale |

## Operations

| Item | Status | Evidence |
| --- | --- | --- |
| Production build | Ready | `next build --webpack` passes (Next 16.4.6) |
| Health checks (`/api/health`, `/api/health/ready` with DB timeout) | Ready | Answered on the production build |
| Unexpected errors traceable | Ready | Every 500/503 returns and logs a `request_id` |
| Commercial hosting plan, domain, HTTPS, `HESBA_APP_ORIGIN` | Needs configuration | Vercel Hobby forbids paid products |
| Scheduler for `/api/cron/*` | Needs configuration | None is bundled |
| Error reporting (`HESBA_SENTRY_DSN`) | Needs configuration | Recommended before Alpha |
| `HESBA_CARD_KEY` generated and backed up | Needs configuration | Lost key = unreadable card serials |
| Real devices (low-end Android, iPhone Safari PWA) | Not tested | Only Playwright 360 px and 1280 px |
| Real AI provider (Gemini) | Not tested | All runs used the mock provider |
| The deployment itself, on a real domain | Not tested | Not run without the owner's approval |
