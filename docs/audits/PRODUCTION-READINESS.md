# Production Readiness

- **Audience:** owner and developers.
- **Date:** 2026-11-08.
- **Branch:** `refactor/production-architecture`, uncommitted.
- **Companion reports:** `USER-FACING-ERRORS.md` (UE-xx) and `BUG-FIX-ROADMAP.md`.

**Verdict: not production-ready.** Core sales do not persist, and inventory and money can diverge. Lint, typecheck, build and the passing tests do not change that: no test covered the sales path until this restructuring, and those new tests document the failure.

---

## 1. What "production-ready" means for Hesba

All of the following must hold, with evidence. Each item names the test or check that proves it.

1. **Sales are durable and consistent.** Recording a sale writes the sale, its lines, the FEFO stock movements and the stock level in one server transaction, idempotent by a client `op_id`. Undo is a reversing `sale.void`.
   - *Proof:* integration tests, including a duplicate-submit test and a concurrency test.
2. **No silent success.** The UI never shows success for a write the server did not accept. Every unsent write is visible as pending.
   - *Proof:* e2e tests with the network failing.
3. **Money and stock never diverge.** Concurrent operations on the same item or machine cannot lose updates. Balances are reconstructible from append-only ledgers.
   - *Proof:* a concurrency integration test.
4. **Tenant isolation holds for every table and route,** including new modules.
   - *Proof:* the cross-tenant suite.
5. **Auth paths work.** Profile save works, and login keeps working afterwards.
   - *Proof:* integration tests.
6. **Offline behavior matches what the UI claims.** Either a working outbox and sync, or an honest "online required" mode.
   - *Proof:* e2e offline test.
7. **Operations are in place.**
   - Errors reach Sentry.
   - Backups exist and a restore has been rehearsed.
   - Migrations run as a deploy step.
   - Required env vars fail fast.
   - CI runs unit, integration and e2e tests.

---

## 2. Scorecard

| # | Category | Status | Evidence | Required before production |
|---|---|---|---|---|
| 1 | Core business functionality | **Blocked** | UE-01/02/03 (sales), UE-04 (profile) confirmed by tests | Roadmap phases 1–3 |
| 2 | Sales and financial correctness | **Blocked** | Revenue not recorded while stock is deducted. Machine balances fall back to local-only (UE-06). No credit sales. | Atomic sale + void; honest machine writes; `opId` on money writes |
| 3 | Inventory correctness | **Needs work** | Append-only ledger and FEFO engine exist and are tested; sales bypass them; no row locks (UE-07); clamp decision (UE-08) | Sales through FEFO; locking; clamp decision |
| 4 | Authentication / authorization | **Needs work** | Login, signup, recovery and sessions tested. Timing leak measured (UE-10). Profile broken (UE-04). Rate limiter in memory. No per-request membership check. | Fix UE-04/10; shared rate-limit store |
| 5 | Tenant isolation | **Ready with caveats** | FORCE RLS on tenant tables; `hesba_app` has no BYPASSRLS; `withTenant` everywhere; 1,410-line cross-tenant suite plus isolation cases in the new specs | Run the cron/community code with a dedicated least-privilege role instead of the migrator (`systemPrisma`); keep `app.is_maintenance` usage minimal |
| 6 | Data integrity | **Blocked** | The DB constraint that rejects sales is correct; the app is wrong. Signup not atomic (UE-12). Settings JSON writes unlocked (K10). | Phases 1, 4, 6 |
| 7 | API reliability | **Needs work** | Unknown errors return a generic 500. P2002/P2025 not mapped (409/404). No `request_id`. The 503 text is misleading. | Error mapping; request ids |
| 8 | Client error handling | **Blocked** | 31 swallowed errors in SalesView; optimistic UI without rollback | Phase 2 |
| 9 | Offline and sync | **Not implemented** | Shell offline only. No outbox or sync. Sync bar misreports. Catalog never downloaded. | Sync-engine ADR + implementation, or an explicit online-only mode |
| 10 | Performance and scalability | **Not verified** | `lastSeenAt` write on every request; balances recomputed from full ledgers; a new Dexie connection per search; no load test | Measure; add indexes as needed |
| 11 | Monitoring / observability | **Needs work** | Sentry wired only through `onRequestError`. Handled 500s never captured (no `captureException` in `src`). The client Sentry config uses the legacy file. | Capture in `toSafeErrorResponse`; `instrumentation-client.ts` |
| 12 | Automated testing | **Needs work** | 273 unit, 161 integration (+5 expected-fail), 16 e2e. Gaps in §3. One stale test (K5). | Phase tests; e2e for sale, undo, offline |
| 13 | CI/CD | **Needs work** | `ci.yml` runs lint, typecheck, unit, build, Docker build, integration. **No e2e job, no deploy workflow.** | e2e job; deploy pipeline with a migrate step |
| 14 | Backup and recovery | **Not implemented** | No `backup.yml`; `docs/runbooks/` empty | Automated backups + rehearsed restore runbook |
| 15 | Security | **Needs work** | Timing leak (UE-10). Emails and IPs logged unredacted (AGENTS rule 12). Migrator credentials at runtime. AI search query not filtered (privacy risk, not demonstrated). | Fix each; least-privilege role |
| 16 | Accessibility / usability | **Needs work** | Duplicate "Alerts" labels (UE-16); about 1,500 lines of hard-coded Arabic outside `ar.json`; no web manifest (not installable) | Labels, i18n extraction, manifest |
| 17 | Documentation / maintainability | **Needs work** | ADR-0017 still Proposed; README outdated; docs describe unbuilt sync; several views over 1,000 lines | Approve ADR; README; view splits later |
| 18 | Deployment / env config | **Needs work** | The DB client silently falls back to a local URL; AI env names mismatch (K9); `HESBA_CARD_KEY` absent from `.env.example`; Dockerfile has no migrate step | Fail-fast config; align names |

---

## 3. Test coverage matrix

| Feature | Unit | Integration | E2E | Important gaps |
|---|---|---|---|---|
| Sales lifecycle | — | `sales-api` (pins defects) | — | Atomic sale + stock; idempotency; void; UI failure handling |
| Credit sales / collections | — | `people-api` (manual ledger entries) | — | Credit sale not implemented |
| Inventory deduction (FEFO) | `stock-property` (fast-check) | `inventory-stock` (incl. FEFO depletion, cross-tenant) | — | Concurrency; sale path doesn't use FEFO |
| Undo sale | — | `sales-api` (refused) | — | Reversal semantics |
| Returns / refunds | — | — | — | Not implemented |
| Financial balances (people) | — | `people-api` | — | Overpayment display; retry duplicates |
| Machine balances | `machines` (client) | `machines-api` | — | Concurrency; idempotency; silent local fallback |
| Authentication | `auth`, password policy | `auth-password-session` | `auth-screens` | Timing equality; rate-limit persistence |
| Profile updates | — | `profile-api` (pins K4) | Screenshot only | Save path; phone normalization |
| Tenant isolation | — | `cross-tenant` + new specs | — | Cron/community with least privilege |
| Offline | `catalog-sync`, `db-upgrade` | `catalog-sync-api` | `shell-offline` (desktop fails, UE-16) | Data offline; outbox; reconnection |
| Duplicate requests | — | `opId` cases in inventory/people | — | Sales, machines, AI client ids |
| Error handling | `error`, `logger` | — | — | 500→Sentry; client failure UX |
| Alerts / promotions | `alerts` | `promotions-api` | — | Selling a promotion end to end |
| AI | `ai-tools`, `ai-cairo-date`, `ai-view` | `ai-backend` | — | Cleanup cron route; search query privacy |

---

## 4. Verification run (2026-11-08, local)

| Check | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | Pass |
| `pnpm test` | 36 files, **273/273** |
| `pnpm test:int` | Local docker-compose Postgres on port 5434. Tests create and remove only their own rows. 16 files: **161 pass, 5 expected-fail, 1 fail.** |
| `pnpm build`, `pnpm test:e2e` | Last run during the restructuring: build passed; e2e 15 pass, 1 fail. Not re-run in this task, which changed comments only (proof in `RESTRUCTURING-CHANGE-REPORT.md` §9). |

**Classification of the failures:**

| Failure | Classification |
|---|---|
| `inventory-stock` adjust delta (K5) | **Existing baseline failure.** Code and test disagree; product decision needed. |
| 5 expected-fail (K1 ×4, K4 ×1) | **Confirmed application bugs**, documented with `it.fails` |
| e2e desktop `shell-offline` | **Application accessibility issue**: duplicate label in untouched files. No pre-restructuring e2e baseline exists. |

---

## 5. Production blockers

**Confirmed:**
- UE-01 sales not saved / stock deducted
- UE-02 sales only in localStorage
- UE-03 undo
- UE-04 profile
- UE-06 machine balances
- UE-09 offline claims and sync status
- no backups
- handled errors invisible to Sentry

**Risks (code-evident, not reproduced):**
- UE-07 concurrent stock updates
- machine balance races
- migrator credentials at runtime
- AI search privacy
- signup partial write

**Unverified assumptions:**
- performance at real data volume
- bundle size
- behavior on a real serverless host (in-memory rate limits, connection pooling)
