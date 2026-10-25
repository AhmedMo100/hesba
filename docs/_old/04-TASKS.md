# Hesba (حسبة) — Complete Task List (v2, rewritten from scratch)

> Two tracks run side by side.
> **MAIN track** = the product code (Phases 0–7 below, plus growth stages G).
> **SIDE track** = domain, servers, accounts, legal, budget (section S). It never blocks the code, **except** the gates marked `⛓`.
>
> Every main task has: an ID, an estimate in person-days (⏱), what to build, and a **✅ Done when** condition. Tasks marked `↔ S-xx` have a side task that runs in parallel.

**ID format:** `P<phase>-<area>-<nn>`. Areas: `PR` Product · `F` Front · `B` Back · `D` DevOps · `Q` QA. Side: `S-<nn>`. Growth: `G<stage>-<area>-<nn>`.

**Symbols:** ☐ not done · ⏱ estimate in person-days · ✅ Done when · ⛓ gate (blocked until the named side task is done) · ↔ runs in parallel with the side task named

**Rules for the agent (Antigravity):**
1. Work on **one phase at a time**, in order. Do not start a phase until the previous phase's ✅ is confirmed by a human.
2. A task is done only when its ✅ condition is met **and** `lint`, `typecheck`, `test` are green (plus `test:int` when the database or sync is touched). Report the real result.
3. Any new library, structure change, or big decision → ADR in `docs/adr/`.
4. Anything missing or contradictory → stop and ask.

**References:** 00 (index) · 01 (system design) · 02 (architecture) · 03 (folders) · 05 (hosting) · 06 (catalog) · 08 (stack) · 09 (database) · 10 (sync) · 11 (UI) · 12 (security) · 13 (testing) · 15 (open decisions) · 16 (agent prompts) · 17 (project setup) · `docs/demo/hesba-demo.html` (look and behaviour).

---

## Phases overview

| Phase | Name | Weeks | Output |
|---|---|---|---|
| 0 | Validation and decisions | 0–1 | Go/no-go + accounts started + decisions recorded |
| 1 | Technical foundation | 1–2 | Repo, CI, empty app running, offline shell, cross-tenant test |
| 2 | Identity, shop and sync | 2–5 | Sign-up, login, sync working offline → online |
| 3 | The eight pages | 3–7 | All demo screens in real code, with sync and the public catalog |
| 4 | Reports, AI and subscriptions | 6–9 | Real Home, AI assistant, manual subscription renewal, shop-to-shop suggestions |
| 5 | Hardening and performance | 8–11 | Security, load test, restore test, migration drill |
| 6 | Alpha | 11–13 | 5–10 real shops |
| 7 | Beta, then public launch | 13–16 | Launch |
| G0–G5 | Growth stages | after 16 | From free tier to 10,000 shops (see `docs/01` section 6) |
| S0–S5 | Side track | runs throughout | Domain, hosting, accounts, legal, budget |

---

# PHASE 0 — Validation and decisions (week 0–1)

> **Goal:** know that shop owners want it, and record the decisions the code depends on. No product code in this phase.

### Product
- ☐ **P0-PR-01** (⏱2) Interview 5–10 shop owners using the demo on their phones. Ask: would you use it? What is missing? What do you use today? What would you pay (in their words, not a number you suggest?). ✅ Notes file with direct quotes and a list of changes.
- ☐ **P0-PR-02** (⏱1) Lock the V1 scope from `docs/07` and write a "deferred to V2" list. ✅ Scope document approved by you.
- ☐ **P0-PR-03** (⏱1) Write the Alpha success targets (for example: sales recorded per shop per day, days of use per week). You choose the numbers; the docs do not invent them. ✅ Targets written in `docs/15`.
- ☐ **P0-PR-04** (⏱1) Catalog decisions from `docs/06` section 1: shop identity hidden, what is shared, daily suggestion cap, number of acceptances N for promotion. ✅ Decisions in `docs/15`. ↔ S-06 (lawyer reviews the wording).
- ☐ **P0-PR-05** (⏱ in parallel with Phases 1–2) Build the first batch of the public catalog (common products) in the CSV template from `docs/06` section 3, and review it twice. ✅ `data/catalog/seed-001.csv` with a second-reviewer sign-off.

### Back / Legal / Business
- ☐ **P0-B-01** (⏱1) Brief the lawyer: Law 151/2020, where data is stored, privacy policy, terms. ✅ Written reply saved in `docs/12` references. ↔ S-06.
- ☑ **P0-B-02** (⏱1) Create the ADR placeholders with options and open questions: ADR-0006 SMS provider, ADR-0007 hosting, ADR-0008 manual renewal (Vodafone Cash / InstaPay). ✅ Three ADR files in `docs/adr/`. *(Aligned with `docs/15`)*
- ☐ **P0-B-03** (⏱1) Decide the team size and the 4-month budget from real quotes. ✅ Budget written in `docs/15`. ↔ S-08.

### DevOps
- ☐ **P0-D-01** (⏱0.5) Create the GitHub organization and the private repo `hesba`. Protect `main` (pull request required, CI required, no force push). ✅ A direct push to `main` is rejected. ↔ S-03.
- ☐ **P0-D-02** (⏱0.5) Password manager for the team and a secret store for the project, with separate staging and production entries. ✅ No secret is in Git. ↔ S-04.
- ☐ **P0-D-03** (⏱1.5) Verify every ❓ item in `docs/05` section 1: current hosting plan prices, commercial-use terms, Neon minimum compute, cron limits, S3-compatible storage. ✅ Updated table where every line has a source link and a date. ↔ S-07.
- ☐ **P0-D-04** (⏱0.5) Write to the hosting provider's support, in writing, asking whether the plan you are considering allows commercial use. ✅ Their written answer is saved. ↔ S-07.
- ☐ **P0-D-05** (⏱0.5) Record the hosting decision (A/B/C/D from `docs/05` section 2) in ADR-0007. Vercel Hobby is for internal development only. ✅ ADR-0007 accepted (status: proposed pending owner decision).
- ☐ **P0-D-06** (⏱0.5) Document product variants (ADR-0009) and services/commissions (ADR-0010) models before any code is written. ✅ ADR-0009 and ADR-0010 accepted, tables listed in docs/09. (Phase 0)

### Front
- ☑ **P0-F-01** (⏱1) Apply the simple interview changes to the demo, then freeze `docs/demo/hesba-demo.html` as the reference version. ✅ Git tag `demo-v1`.

### Gates for this phase
- ⛓ Nothing in Phase 0 is blocked by the side track, except that ADR-0006 needs S-07.

### Risks in this phase
- **Lawyer or providers reply slowly** ← start now; Phase 1 does not depend on them.
- **Interviews say "we don't need it"** ← this is the cheapest moment to change direction. Do not continue just because you started.

---

# PHASE 1 — Technical foundation (week 1–2)

> **Goal:** a running, tested, deployable empty app, with the tenant isolation proven.

### Product
- ☐ **P1-PR-01** (⏱1) Turn the demo into a screen list with four states per screen: Empty, Loading, Error, Offline (the 8 pages + auth). ✅ States table in `docs/11`.
- ☐ **P1-PR-02** (⏱0.5) Write the glossary of product words (product, batch, movement, sale, takes, outbox, shop) in Arabic and English. The same words are used in code, UI, and docs. ✅ Glossary in `docs/07`.

### Front
- ☐ **P1-F-01** (⏱1) Scaffold the app following `docs/17` sections 3–6 and the structure in `docs/03`. Delete the sample page. Set up Serwist and check it against the pinned Next.js version. ✅ `pnpm dev` runs; `output: 'standalone'` is set; the Serwist check is written in `docs/15`. ⛓ none.
- ☐ **P1-F-02** (⏱1) Design tokens: CSS variables from the demo for light, dark and automatic themes; Tajawal font served locally from `public/fonts/`. ✅ Theme switch works; no request to an external font server at runtime.
- ☐ **P1-F-03** (⏱2) Port the basic UI from the demo into `src/client/shared/ui`: Button, Field, SearchBox, Seg, Modal/Sheet with the `useGhost` hook, Toast, Chips. ✅ A `/dev/ui` playground page shows all of them; the page is not reachable in production.
- ☐ **P1-F-04** (⏱1.5) Client-only Shell under `/app/[[...slug]]` (`dynamic` with `ssr: false`), internal Router, Header, BottomNav, a visual-only SyncBar, and the 8 empty pages. ✅ Navigation works at 360px, and works offline after the first online open.
- ☐ **P1-F-05** (⏱0.5) i18n: `ar.json`, a `t()` function, RTL, number/currency/date formatting. Times are stored in UTC and shown in Cairo time. ✅ A test or lint rule finds no visible text hard-coded in components.

### Back
- ☐ **P1-B-01** (⏱1) `src/server/config/env.ts` (zod: the app refuses to start when a variable is missing), the logger (pino), the error model, `GET /api/health` (liveness) and `GET /api/health/ready` (checks the database), `import 'server-only'` in `src/server`, and the import boundaries in ESLint. ✅ Starting without a variable fails with a clear message; a forbidden import fails `lint`.
- ☐ **P1-B-02** (⏱1) Postgres connection (`postgres` driver) + Drizzle + the migration runner (`scripts/migrate.ts`) + `0001_init` with tables `stores`, `users`, `store_members`, `devices`. Follow `docs/09`. ✅ `pnpm db:migrate` runs twice on an empty database with no error.
- ☐ **P1-B-03** (⏱1) `withTenant()`: `set_config(..., true)` inside a transaction. `0002_rls_policies` for the existing tables. The application role is not superuser and does not bypass RLS. Test on the **pooled** connection string as well. ✅ The cross-tenant test passes; and it **fails** when RLS is disabled (proves the test is real).
- ☐ **P1-B-04** (⏱0.5) `src/schemas` and `src/domain`: `money.ts` (integer piasters only), `units.ts` (piece and gram as base units), `time.ts` (UTC storage, Cairo display). Unit tests. ✅ Unit tests green.

### DevOps
- ☐ **P1-D-01** (⏱1) `docker-compose.dev.yml` with Postgres (MinIO only if a task needs it). ✅ `pnpm dev` runs the whole app with the database up.
- ☐ **P1-D-02** (⏱1.5) `.github/workflows/ci.yml`: install with frozen lockfile, lint, typecheck, unit tests, build, **Docker build** (portability), dependency audit, secret scan. Integration tests are added in P1-Q-01. ✅ A pull request shows green checks.
- ☐ **P1-D-03** (⏱1) Staging on the chosen hosting (ADR-0006), a separate database (a Neon branch or project), automatic deploy from `main`, Sentry for staging. ⛓ S-01 (domain bought), S-02 (DNS active), S-10 (staging account). ↔ S-05 (Sentry). ✅ `/api/health/ready` answers over HTTPS on the real domain.
- ☐ **P1-D-04** (⏱0.5) Dependabot (weekly, grouped updates) and a `.env.example` with dummy values only. ✅ Both committed.
- ☐ **P1-D-05** (⏱0.5) Git hooks: lefthook pre-commit (prettier + eslint on staged files) and commitlint (Conventional Commits). ✅ A bad commit message is rejected on your machine.
- ☐ **P1-D-06** (⏱0.5) `AGENTS.md`, `README.md`, and ADR-0001 to ADR-0007 drafts committed. ✅ All present in the repo.

### QA
- ☐ **P1-Q-01** (⏱1) Test foundation: Vitest unit tests, a fast-check example, Testcontainers with real Postgres for integration tests, one Playwright offline test. ✅ `pnpm test` and `pnpm test:int` run in CI.

### ✅ Done-when (Phase 1)
`pnpm dev` runs locally · CI is green · staging answers `/api/health/ready` over the real domain · the shell navigates offline after the first online open · the cross-tenant test exists and fails when RLS is turned off.

### Risks (Phase 1)
- **Open technical choices (ORM, driver, Serwist compatibility)** slow everything ← decide in the first two days with ADRs, then do not change them.
- **The agent creates a different structure** ← `AGENTS.md` plus a careful review of the first pull request.
- **Over-engineering the config** ← any tool not listed in `docs/03` or `docs/08` waits.

---

# PHASE 2 — Identity, shop and sync (week 2–5)

> **Goal:** a real user signs up, records an operation offline, and it reaches the server exactly once. **This is the riskiest phase.** Give it extra time, and do not start Phase 3 pages until sync is stable.

### Product
- ☐ **P2-PR-01** (⏱1) OTP policy: when it is requested, number of attempts, what to do if SMS is down (the alternative from S-22). Final privacy and terms text from the lawyer. ✅ Policy in `docs/12`. ⛓ S-06 (for the final text).
- ☐ **P2-PR-02** (⏱0.5) Colloquial Arabic error messages for every case: wrong number, wrong code, network down, session expired, server updating. ✅ Messages in `ar.json`, reviewed by a native speaker. ↔ S-12.
- ☐ **P2-PR-03** (⏱0.5) Define "needs review": which rejected operations count, and how the user sees them in plain words. ✅ Rule written in `docs/10`.

### Front
- ☐ **P2-F-01** (⏱3) Auth pages: sign-up in two steps ("عنك" about you, "محلك" your shop), login, OTP verification. Server Actions for these. ✅ Looks like the demo; works at 360px.
- ☐ **P2-F-02** (⏱1) Client session state, optional PIN lock, and the behaviour when the session expires offline (selling continues; authentication happens at sync time). ✅ Covered by the E2E test in P2-Q-01.
- ☐ **P2-F-03** (⏱2.5) Dexie database (`src/client/shared/db`): all local tables, versions, and upgrade code. ✅ An upgrade test from version 1 to version 2 keeps the data.
- ☐ **P2-F-04** (⏱4) Sync engine (`engine.ts`, `outbox.ts`, `apply-changes.ts`). **Event-driven only**: after a write (debounced), on app open, on `online`, when the tab becomes visible, and on a manual button. Backoff with jitter. Handles 503 (with Retry-After), 401, 403, 409, 413, 429, 204. **No `setInterval` anywhere in sync code.** ✅ Cut the network in the middle of a push → after reconnect the operation is sent exactly once. A test fails if `setInterval` appears in the sync folder.
- ☐ **P2-F-05** (⏱1) A real SyncBar and a "needs review" screen listing rejected operations and their reasons. ✅ A rejected operation appears on that screen.
- ☐ **P2-F-06** (⏱1) Profile modal wired to the API. ✅ Saves, and shows the server error text when it fails.

### Back
- ☐ **P2-B-01** (⏱3) Auth: OTP request and verify, with limits per phone number, IP, and device. Argon2id (`@node-rs/argon2`): measure the time on the target hardware and tune the parameters in config. A rotating httpOnly session cookie, stored hashed in the database, with reuse detection. ✅ Brute-force attempts are blocked; reusing an old session revokes the whole session chain.
- ☐ **P2-B-02** (⏱1.5) Tenancy: create a shop, members, roles (owner, worker), trial subscription row. ✅ A worker cannot call an owner-only action (tested).
- ☐ **P2-B-03** (⏱1) SMS interface + provider adapter + sending job through the `jobs` table. ⛓ S-05 (SMS trial account). ✅ An OTP arrives on a real test phone in staging.
- ☐ **P2-B-04** (⏱3) Sync endpoints: `POST /api/sync/push`, `GET /api/sync/pull`. Handler registry in `handlers.ts`. Push is idempotent by `op_id`. Pull uses a cursor and returns 204 when there is nothing new. Tables `change_log` and `sync_ops`. Soft maintenance mode (503 + Retry-After). Origin check and the `X-Hesba-Client` header. ✅ Integration tests: duplicate operation, rejected operation, ordering, two devices.
- ☐ **P2-B-05** (⏱1) `schema_v` in every sync request and response, and a written policy for supporting two versions at once. ✅ An old version receives 409 with a clear upgrade message.
- ☐ **P2-B-06** (⏱1) Basic `audit_log` (who, what, when, which shop). No personal data in the payload. ✅ Written on sign-in and tenancy actions.
- ☐ **P2-B-07** (⏱2) Jobs system: `jobs` table + `POST /api/cron/tick` protected by a secret header, `FOR UPDATE SKIP LOCKED`, retries, dead status. ⛓ S-07 (the hosting decides how the tick is scheduled). ✅ When the tick is called twice at the same moment, a test job runs exactly once.
- ☐ **P2-B-08** (⏱0.5) `flags` table with the maintenance-mode flag, and `docs/runbooks/maintenance-mode.md`. ✅ Turning the flag on makes sync return 503.

### DevOps
- ☐ **P2-D-01** (⏱1) Secrets in staging. Rate limiting for auth routes at the edge (Cloudflare rules). ↔ S-02.
- ☐ **P2-D-02** (⏱1) Dashboard: Sentry, uptime monitor, log search. ↔ S-05 (uptime monitor account).

### QA
- ☐ **P2-Q-01** (⏱2) E2E: sign up → log in → network off → add an operation → network on → it is synced exactly once.
- ☐ **P2-Q-02** (⏱1) Security tests: OTP brute force, session reuse, cross-tenant access on **every** new endpoint.

### ✅ Done-when (Phase 2)
A new user signs up and logs in · an operation recorded offline is synced exactly once · two devices of the same shop end up with the same data · cross-tenant tests are green.

### Risks (Phase 2)
- **Sync takes longer than planned (most likely)** ← this is the riskiest part. Give it spare time and do not start Phase 3 until it is stable.
- **Two devices conflict in a way nobody thought about** ← write each conflict case as a test before the code.
- **Session expires while offline** ← the queue stays saved, selling continues, and authentication happens at sync. Test it explicitly.
- **SMS provider is slow or rejects us** ← build the adapter so a second provider can be added (S-22), and set a cost cap.
- **Server Actions used for offline work** ← every offline operation goes through `/api/sync/*` (`docs/02` section 2). Otherwise it breaks after the next deploy.

---

# PHASE 3 — The eight pages (week 3–7)

> **Goal:** every demo screen works in real code, with the same look, and works offline.
> **Order:** selling and inventory first. Each page = Front + Back + Sync + Test.

### Product
- ☐ **P3-PR-01** (⏱1) Compare every page with the demo. Write the list of accepted differences. ✅ List in `docs/11`.
- ☐ **P3-PR-02** (⏱1) Alert rules, starting from the demo values in `docs/11` (weight below 3 kg, packs below 2× the pack quantity, otherwise below 10; out at 0; expiry within 7 days). Adjustable per shop later. ✅ Rules in `constants.ts` with a comment.
- ☐ **P3-PR-03** (⏱0.5) Empty-state texts (no products, no sales, no expenses). ✅ Texts in `ar.json`. ↔ S-12.

### 3.0 Public catalog and custom products (`docs/06`)
- ☐ **P3-PR-04** (⏱3) Complete the catalog: all sections, double review, similarity report between items. ✅ `seed-00x.csv` files and a `catalog_version`.
- ☐ **P3-B-07** (⏱3) `drizzle/0003_catalog.sql`: `global_products`, `products.global_product_id`, `pg_trgm`. `scripts/import-catalog.ts` with normalization and a duplicate report. **No automatic merging.** ✅ Import runs; duplicates are listed, not merged.
- ☐ **P3-B-08** (⏱2) `src/domain/normalize.ts` for Arabic text: hamza forms, alif maqsura, ta marbuta, Arabic-Indic digits. 30+ real-value tests. ✅ All tests green.
- ☐ **P3-B-09** (⏱2) `GET /api/sync/catalog?cursor=` (incremental, compressed gzip/brotli, ETag, long cache). ✅ A second call with the same cursor returns 204 or 304.
- ☐ **P3-B-11** (⏱2) Market seed import from CSV files in `data/catalog/` (`scripts/import-catalog.ts`): reference prices only, shop's own price always wins. ✅ Seed import tested. (Phase 3)
- ☐ **P3-F-12** (⏱3) `catalog-sync` + Dexie table `global_products` with a `name_norm` index. ✅ Search works offline and is fast.
- ☐ **P3-F-13** (⏱3) Adding a product: local matching against the catalog ("is this the same as X?"). Creating a **custom product** always goes to the database, with the shop's own price. ✅ Custom product saved and synced.
- ☐ **P3-Q-03** (⏱1.5) Tests: normalization, RLS on `products`, no endpoint returns a shop's identity, offline behaviour. ✅ All green.

### 3.1 Products and inventory
- ☐ **P3-B-01** (⏱3) `catalog` module: products, units (piece, carton, weight), prices, the `product.upsert` handler. ✅ Handler is idempotent and tested.
- ☐ **P3-B-10** (⏱3) Product variants domain model: `brands`, `global_products`, `global_variants`, `store_variants`, `store_stock_batches`, variant barcodes, prices, and pack quantities (ADR-0009). ✅ Model and tests green. (Phase 3)
- ☐ **P3-B-02** (⏱4) `inventory` module: batches, append-only movements, `stock.add`, waste, balance (`stock_levels` cache), stock alerts. ✅ Balance equals the sum of movements in property tests.
- ☐ **P3-F-01** (⏱3) ProductsPage, ProductFormModal, price row, search. ✅ Matches the demo at 360px.
- ☐ **P3-F-02** (⏱3) StockPage, AddStockModal, combobox, additions log. ✅ Matches the demo.
- ☐ **P3-Q-01** (⏱2) Inventory property tests: sum of movements = balance, for random sequences. ✅ Green on 1,000+ generated sequences.

### 3.2 Selling
- ☐ **P3-B-03** (⏱4) `src/domain/fefo.ts` (used on both client and server) and the `sales` module: `sale.create`, `sale.void` (reverses using `takes`), negative stock allowed and flagged. ✅ Void restores the exact batches taken.
- ☐ **P3-F-03** (⏱5) SalesPage: sell tile, weight popover (segmented control + quick chips), undo, total bar, out-of-stock state. ✅ Works offline; matches the demo.
- ☐ **P3-Q-02** (⏱2) Scenarios: carton, weight, out of stock, void then sell again, an offline sale on two devices for the same product. ✅ All behave as specified in `docs/10`.

### 3.3 Expenses and people
- ☐ **P3-B-04** (⏱2) `expenses` module and categories (the demo's list). ✅ Tested.
- ☐ **P3-B-05** (⏱3) `people` module with on-account movements (customer, supplier, worker). ✅ A customer balance equals the sum of their movements.
- ☐ **P3-F-04** (⏱2) ExpensesPage. ✅ Matches the demo.
- ☐ **P3-F-05** (⏱3) PeoplePage and PersonModal. ✅ Matches the demo.

### 3.4 Alerts and Home (local data only; server reports come in Phase 4)
- ☐ **P3-B-06** (⏱2) `alerts` module: low stock, near expiry, negative stock, sync rejection. ✅ Tested for each rule.
- ☐ **P3-F-06** (⏱2) AlertsPage and a count badge in the bottom navigation. ✅ Count matches the list.
- ☐ **P3-F-07** (⏱2) HomePage from local Dexie data, with the SVG bar chart (no chart library). ✅ Matches the demo.
- ☐ **P3-F-08** (⏱1) CSV export of inventory, loaded with a dynamic import. ✅ Downloads a valid file.

### 3.5 Performance and accessibility
- ☐ **P3-F-09** (⏱2) Lazy chunks, prefetch, and a bundle-size budget enforced in CI. ✅ CI fails when the budget is exceeded.
- ☐ **P3-F-10** (⏱2) Real-device check on 3 phones, including a low-spec Android (⛓ S-23 for the devices). Widths 320, 360, 390 px. ✅ Recorded results in `docs/13`.
- ☐ **P3-F-11** (⏱1) Accessibility: focus order, touch targets 44 px or more, `prefers-reduced-motion`. ✅ Checked with an automated audit and by hand.

### 3.6 Services, prepaid cards and commissions (ADR-0010)
- ☐ **P3-B-12** (⏱3) Services and commissions model: `service_items`, `card_serials` (encrypted at rest with `HESBA_CARD_KEY`, sold once), `commission_rules` with ranges and automated fee calculation, manual override audit logging. ✅ Card single-sale invariant and rule calculations tested. (Phase 3)
- ☐ **P3-F-14** (⏱3) Services and prepaid cards screen: service category selection, bill/transfer amount input with auto-calculated commission, card sale with one-time PIN reveal. ✅ Matches the demo at 360px. (Phase 3)
- ☐ **P3-Q-04** (⏱2) Commission and card tests: rule-based fee calculation, range edge cases, manual override logging, single-sale card invariant (sold card cannot be sold again), PIN encryption at rest and redaction in logs. ✅ All tests green. (Phase 3)

### DevOps
- ☐ **P3-D-01** (⏱1) Test data for staging and a reset script (never run against production). ✅ Reset works and is guarded by an environment check.
- ☐ **P3-D-02** (⏱1) Preview environments for pull requests, if the budget allows. ✅ Optional; record the decision.

### ✅ Done-when (Phase 3)
Every demo screen works with the same look and behaviour · no core step needs the internet · inventory and sales tests are green · the initial bundle is within budget.

### Risks (Phase 3)
- **Inventory errors (the most dangerous)** ← a wrong number costs a shop its trust. Property tests and a "recompute balance" script.
- **Scope creep ("just one more small thing")** ← anything new is V2 unless the interviews proved it critical.
- **Slow on weak phones** ← test on a cheap device early, not at the end.
- **Big lists (5,000 products)** ← virtualized list and indexed search in Dexie.
- **Dexie upgrade breaks user data** ← an upgrade test from every previous version.

---

# PHASE 4 — Reports, AI and subscriptions (week 6–9)

> **Goal:** Home numbers come from the server and are correct, the AI assistant answers only from database numbers, manual subscription renewals work, and shop-to-shop suggestions are safe.

### Product
- ☐ **P4-PR-01** (⏱1) Subscription plans (decided from real quotes, not guesses) and the pricing page text. ✅ Plans in `docs/15`.
- ☐ **P4-PR-02** (⏱1) The list of 10–15 AI questions supported in V1, and the "I can't answer that" reply for everything else. ✅ List in `docs/16`.
- ☐ **P4-PR-03** (⏱0.5) Trial policy and what happens when a subscription ends (read-only, grace period). ✅ Written in `docs/12`.
- ☐ **P4-PR-04** (⏱1) Tune the suggestion values: daily cap, first-wave size, N for promotion, K for reports, banned words. ✅ Values in `constants.ts`.

### Back
- ☐ **P4-B-01** (⏱3) `daily_store_stats` table, aggregation job, rebuild (backfill), and tests that compare results with the raw tables. ✅ Aggregates equal raw totals on the test data.
- ☐ **P4-B-02** (⏱2) `reports` endpoints for Home (day, week, month). ✅ Numbers match manual calculation for 3 scenarios (P4-Q-01).
- ☐ **P4-B-03** (⏱4) `ai` module: read-only SQL tools, tool selection, phrasing, an atomic daily quota of 5 messages enforced on the server, timeout, fallback reply. ✅ The model never computes numbers itself; the quota cannot be bypassed from the client.
- ☐ **P4-B-04** (⏱3) `billing` module: plans, subscription model, trial period, subscription expiration check, subscription status available to the session and to sync. ✅ Status changes are reflected in the app.
- ☐ **P4-B-05** (⏱2) Manual renewal administrative actions: admin endpoint/action to activate or extend a shop's subscription (`current_period_end`), manual verification workflow, and audit logging of every manual activation in `audit_log`. ✅ Admin extends subscription; action is recorded in `audit_log`.
- ☐ **P4-B-06** (⏱1) Per-shop rate limits on sync and AI. ✅ Limit tested.

### Front
- ☐ **P4-F-01** (⏱2) HomePage reads from the reports, with the local offline fallback from Phase 3. ✅ Works offline and online.
- ☐ **P4-F-02** (⏱3) AiPage: chat, message counter, locked state. ✅ Matches the demo; counter matches the server.
- ☐ **P4-F-03** (⏱2) Subscription and renewal screen with states: trial, active, expired, showing Vodafone Cash / InstaPay transfer numbers (`HESBA_RENEWAL_VODAFONE_CASH`, `HESBA_RENEWAL_INSTAPAY`) and direct WhatsApp confirmation link (`HESBA_RENEWAL_WHATSAPP`). ✅ All three states tested; renewal info and WhatsApp link displayed.
- ☐ **P4-F-04** (⏱1) App behaviour when a subscription ends (per P4-PR-03), **without deleting any data**. ✅ Tested.

### DevOps
- ☐ **P4-D-01** (⏱1) A read-only database connection for the AI and reports (a replica when the hosting provides one). ✅ Heavy reports do not slow sync.
- ☐ **P4-D-02** (⏱1) Separate job types (reports, SMS, billing, suggestions) with a dead status and a review screen. ✅ A dead job can be retried from the screen.
- ☐ **P4-D-03** (⏱1) Alerts on queue depth and daily AI cost. ✅ Alerts fire in a test.

### QA
- ☐ **P4-Q-01** (⏱2) Report numbers match manual calculation for 3 scenarios.
- ☐ **P4-Q-02** (⏱2) AI tests: supported and unsupported questions, the 5-per-day limit, an attempt to bypass the limit from the client.
- ☐ **P4-Q-03** (⏱1.5) Manual renewal flow tests: trial expiration, manual admin activation, audit log entry verification, read-only mode enforcement upon expiration without data deletion. ✅ Tested.

### 4.x Suggestions between shops (`docs/06`)
- ☐ **P4-B-07** (⏱3) Suggestion tables (`catalog_candidates`, `catalog_suggestions`, `catalog_reports`) with RLS and protection against identity leakage. ✅ Leakage test passes.
- ☐ **P4-B-08** (⏱4) Server flow: automated check → matching (barcode, then `pg_trgm`) → candidate → a job picks suitable shops (same shop type, no existing match, under the daily cap) → `suggestion.accept | dismiss | report` → promotion to the public catalog at N acceptances. ✅ Each step tested.
- ☐ **P4-B-09** (⏱3) `/admin/catalog`: candidates, merge, reject, approve, reports, with `audit_log`. ✅ Admin actions are logged.
- ☐ **P4-F-05** (⏱3) Suggestion card with [Add] [Not needed] [Report]. After adding, focus goes to the price field (the price is **not** copied). Works offline through the outbox. ✅ Tested offline.
- ☐ **P4-F-06** (⏱1) Profile settings: "don't share my custom products" and "receive suggestions". ✅ Settings respected by the server.
- ☐ **P4-Q-04** (⏱2.5) Tests: identity leakage, RLS on suggestions, concurrent duplicates, daily cap, automatic promotion, offline acceptance. ✅ All green.

### ✅ Done-when (Phase 4)
Home numbers match manual calculation · the AI never makes up numbers and is limited to 5 per day by the server · manual subscription renewal and expiration tested · ending a subscription deletes no data · suggestions reach suitable shops without leaking identity or prices.

### Risks (Phase 4)
- **Weak or annoying suggestions** ← small first wave, daily cap, and watch the acceptance rate (`docs/06` section 5).
- **Manual renewal confirmation delay** ← admin notifications via WhatsApp, clear renewal instructions for shop owners.
- **AI cost grows** ← a per-shop daily limit, a global budget, and an automatic lock.
- **Wrong report numbers** ← a daily automated comparison between aggregates and raw data.
- **The LLM invents numbers** ← no arithmetic by the model; every number comes from SQL tools.

---

# PHASE 5 — Hardening, security and performance (week 8–11)

> **Goal:** the system survives the things that will go wrong. No new features in this phase.

### Product
- ☐ **P5-PR-01** (⏱1) Final privacy policy and terms (from the lawyer, ⛓ S-06), plus an account deletion and data export page. ✅ Both pages work end to end.
- ☐ **P5-PR-02** (⏱1) Final review of every error message and empty state. ✅ Signed off by a native speaker. ↔ S-12.

### Back
- ☐ **P5-B-01** (⏱3) Review every hot query with `EXPLAIN`, indexes, and `pg_stat_statements`. ✅ No query over the target time in the load test.
- ☐ **P5-B-02** (⏱2) Full rate limits, brute-force protection, and CAPTCHA only when activity looks suspicious. ✅ Tested.
- ☐ **P5-B-03** (⏱2) Account deletion and data export as jobs. ✅ Export contains everything and deletion removes it, tested.
- ☐ **P5-B-04** (⏱2) Graceful shutdown, timeouts, and circuit breakers on external services (SMS, AI). ✅ Each one tested with a forced failure.
- ☐ **P5-B-05** (⏱1.5) Review `audit_log` and the owner/worker permissions. ✅ Checklist in `docs/12` completed.

### Front
- ☐ **P5-F-01** (⏱2) Error boundaries, and error reports to Sentry with no personal data. ✅ A forced error appears in Sentry without personal fields.
- ☐ **P5-F-02** (⏱2) Service Worker update strategy, an "Update the app" screen that keeps the queue, and a kill switch. ✅ Update does not drop pending operations.
- ☐ **P5-F-03** (⏱2) Performance tuning on a weak device: Lighthouse, bundle, images. ✅ Within the budget from P3-F-09.
- ☐ **P5-F-04** (⏱1.5) Install prompt, icons, splash screen. ✅ Installs on Android and iOS (Safari steps documented).

### DevOps
- ☐ **P5-D-01** (⏱4) Production on **commercial hosting** (ADR-0006) with a paid database plan when needed, point-in-time recovery, and an encrypted off-site backup. ⛓ S-30 (commercial hosting decision and upgrade), S-31 (backup storage). ✅ Production is live.
- ☐ **P5-D-02** (⏱2) **Real restore test** from backup, documented in `docs/runbooks/db-restore.md`. ✅ Restored data matches a known checksum.
- ☐ **P5-D-03** (⏱2) **Load test (k6):** sync storm, evening peak, AI traffic. Record results, tune limits. ✅ Meets the targets written in `docs/13`.
- ☐ **P5-D-04** (⏱1.5) Cloudflare: WAF rules, rate limits, SSL strict, HSTS. ⛓ S-32. ✅ Checked with an external scanner.
- ☐ **P5-D-05** (⏱2) Monitoring: metrics, alerts, status page, runbooks. ↔ S-33. ✅ A test alert reaches you.
- ☐ **P5-D-06** (⏱1) Rollback procedure and zero-downtime deploy. ✅ A rollback is done once on staging.
- ☐ **P5-D-07** (⏱3) **Migration drill on staging:** the runbooks `move-hosting.md`, `move-database.md`, `maintenance-mode.md`, and a real move of the app and then the database (`docs/05` R1 and R2), with soft maintenance mode, then confirm that a test device's outbox synced after the return. ✅ Migration time and rollback plan recorded.
- ☐ **P5-D-08** (⏱1) Security headers (CSP, HSTS, frame and referrer policies). ✅ Checked in CI.

### QA and security
- ☐ **P5-Q-01** (⏱3) Pentest, internal and preferably external (⛓ S-34 for the external one), and fixing the findings. ✅ No critical or high findings open.
- ☐ **P5-Q-02** (⏱2) Device and browser matrix: old Android, iPhone, Chrome, Samsung Internet. ✅ Matrix recorded in `docs/13`.
- ☐ **P5-Q-03** (⏱1.5) Offline chaos test: cut the connection at every step of push and pull. ✅ No duplicates, no lost operations.

### ✅ Done-when (Phase 5)
A restore was done · the load test meets its targets · the pentest has no open critical findings · cross-tenant tests are green · runbooks are written.

### Risks (Phase 5)
- **The load test reveals an architecture problem** ← there is still time. If it is serious, postpone Alpha instead of launching a weak system.
- **The pentest finds many issues** ← the fix week is already counted above.
- **Team fatigue** ← no features in this phase.

---

# PHASE 6 — Alpha (week 11–13)

> **Goal:** 5–10 real shops use it, and the real numbers replace the assumptions.

### Product
- ☐ **P6-PR-01** (⏱2) Pick 5–10 shops of different kinds (small, supermarket, neighbourhood). A written agreement that this is a trial version. ✅ Agreements signed.
- ☐ **P6-PR-02** (⏱3) A weekly visit or call with each shop, and a notes log. ✅ Log exists for every shop every week.
- ☐ **P6-PR-03** (⏱1) Replace the assumptions in `docs/01` table 02 (`S, L, D, H, K, B, P`) with measured values. ✅ Table updated.
- ☐ **P6-PR-04** (⏱1) Top-10 changes ranked by real usage, not opinion. ✅ List in `docs/14`.
- ☐ **P6-PR-05** (⏱1) Write the support hours and the "what we do not support" list. ✅ Published to shops. ↔ S-11.

### Front and back
- ☐ **P6-F-01** (⏱5) UX fixes from feedback (text, spacing, number of steps). ✅ Each fix linked to a shop's note.
- ☐ **P6-B-01** (⏱5) Bug fixes, and a review of every rejected real operation. ✅ No unexplained rejections.
- ☐ **P6-B-02** (⏱1) Internal support tools: shop lookup, sync status, latest errors, recompute balance. ✅ Only the team can open them.

### DevOps
- ☐ **P6-D-01** (⏱1) "Shop health" dashboard: last sync, queue size, error count. ✅ Shows every alpha shop.
- ☐ **P6-D-02** (⏱1) Support channel (WhatsApp Business) and an on-call rota. ⛓ S-11. ✅ Working and staffed.
- ☐ **P6-D-03** (⏱1) Real cost per shop (database, SMS, AI). ✅ Recorded in `docs/15`. ↔ S-51.

### ✅ Done-when (Phase 6)
Two consecutive weeks with no data loss · the target from P0-PR-03 is met (for example, 70% of shops open the app at least 4 days a week, if that is the target you set) · real numbers are in the system design.

### Risks (Phase 6)
- **A shop goes back to the notebook** ← usually an extra step or slowness. Watch where they stop.
- **A data problem at one shop = a trust crisis** ← top priority, and honest communication.
- **Real use is much higher than assumed** ← move to the next growth stage earlier.
- **Only one person handles support** ← set support hours and cut requests by improving UX.

---

# PHASE 7 — Beta, then public launch (week 13–16)

> **Goal:** a closed beta, then a launch that will not break under the first wave of users.

### Product
- ☐ **P7-PR-01** (⏱2) Closed beta (30–100 shops) by invitation, plus a waiting list. ✅ Invitations sent and tracked.
- ☐ **P7-PR-02** (⏱3) Arabic landing page, a short explainer video, and an FAQ with no unproven claims. ⛓ S-43 (lawyer checks the claims). ↔ S-42. ✅ Every claim traces to a real feature.
- ☐ **P7-PR-03** (⏱2) Onboarding: the first five minutes (optional sample data, first products, first sale). ✅ Tested with 3 new users.
- ☐ **P7-PR-04** (⏱1) Final pricing from real cost calculations. ✅ Published.
- ☐ **P7-PR-05** (⏱2) Support materials: a short illustrated guide and ready-made replies. ✅ Published in the app.

### Back and front
- ☐ **P7-B-01** (⏱3) Beta fixes and performance improvements from measurements. ✅ Beta bug list is empty for critical items.
- ☐ **P7-F-01** (⏱3) Signup and onboarding conversion improvements, based on data. ✅ Each change measured.
- ☐ **P7-F-02** (⏱1) Status page and in-app notices for outages. ⛓ S-33. ✅ Notice appears in a test.

### DevOps
- ☐ **P7-D-01** (⏱2) Final load test at twice the expected launch load. ✅ Meets the targets.
- ☐ **P7-D-02** (⏱1) Launch checklist: SSL, DNS, backups, alerts, rollback, secrets, provider quotas. ✅ Every item checked.
- ☐ **P7-D-03** (⏱1) Raise SMS and AI limits before launch. ⛓ S-40 (quota requests are slow). ✅ Limits confirmed in writing.
- ☐ **P7-D-04** (⏱1) On-call and support for the first two weeks: who, when, which channel. ✅ Rota published.

### ✅ Done-when (Phase 7)
Beta runs 7 days with no critical problems · the final load test passes · the launch checklist is all ticked · a support channel is running.

### Risks (Phase 7)
- **Launch with more load than we can serve** ← gradual launch by invitation, and a feature flag on signup.
- **SMS or AI caps** ← raise the limits before announcing.
- **Small complaints blow up** ← quick, honest reply and a public fix.
- **A legal mistake (advertising, data)** ← the lawyer reviews the landing page and the terms.

---

# GROWTH STAGES (G0–G5) — after launch

> Moving between stages is decided by **indicators** (`docs/01` section 6), not by the shop count alone. Numbers below are guidance.

### G0 — From free to paid (`docs/05`)
- ☐ **G0-01** (⏱0.5) First paying customer → hosting must be commercial first. ⛓ S-30.
- ☐ **G0-02** (⏱1) Neon free tier: plan upgrade when storage or compute passes 70% (`docs/05` section 7). Upgrade without migration. ↔ S-53.
- ☐ **G0-03** (⏱1) Review load assumptions with real numbers and update `docs/05` section 3.
- ☐ **G0-04** (⏱2) Move the app to Docker only if cost or limits require it. The database does not move on the same day.
- **Risk:** forgetting to upgrade before a limit ← alerts on the indicators from Phase 2.

### G1 — 100 → 500 shops (Stage 2)
- **Back:** G1-B-01 read replica for reports and AI · G1-B-02 review indexes and queries · G1-B-03 cache for subscription and limit lookups (**Redis only by ADR**, if measurements show it is needed).
- **DevOps:** G1-D-01 autoscaling or 2–3 Docker instances behind a load balancer · G1-D-02 review connection pooling · G1-D-03 load test at every launch.
- **Front:** G1-F-01 backoff and jitter tuned with alpha and beta numbers.
- **Product:** G1-PR-01 acquisition channels and retention indicators.
- **Risks:** sync storm after a regional outage · the first very large shop uses most resources.

### G2 — 500 → 2,000 shops (Stage 3)
- **Back:** G2-B-01 monthly partitioning for `sales`, `sale_lines`, `stock_movements`, `change_log` · G2-B-02 archiving job · G2-B-03 per-shop limits and monitoring of the top 20 shops.
- **DevOps:** G2-D-01 separate worker or a real queue if the cron tick is not enough · G2-D-02 tracing · G2-D-03 multi-zone and a failover test · G2-D-04 feature flags.
- **Product:** G2-PR-01 deeper reports **only** if they improve retention.
- **Risks:** migrations on huge tables · SMS and AI cost · the first slow-report incident.

### G3 — 2,000 → 5,000 shops (Stage 4)
- **Back:** G3-B-01 move sync out as its own service · G3-B-02 move AI out as its own service (replica only) · G3-B-03 rule: no reports on huge raw data.
- **DevOps:** G3-D-01 more than one replica and autovacuum tuning · G3-D-02 scheduled load tests · G3-D-03 formal on-call · G3-D-04 yearly external pentest.
- **Product:** G3-PR-01 first support and sales staff.
- **Risks:** depending on one person · a long failover on a large database.

### G4 — 5,000 → 10,000 shops (Stage 5)
- **Back:** G4-B-01 scale up or shard, decided by measurement (ADR) · G4-B-02 if sharding: a store directory, a router, per-shard migrations, cross-shard reports.
- **DevOps:** G4-D-01 disaster recovery region (warm standby) as required by law · G4-D-02 SLOs and error budget · G4-D-03 a dedicated SRE.
- **Risks:** sharding complexity · DR cost · development slowing down with size.

### G5 — Always (operational)
- G5-01 restore drill, quarterly (`docs/12`) · G5-02 monthly cost-per-shop review · G5-03 monthly dependency updates · G5-04 quarterly security review · G5-05 review load assumptions at every stage.

---

# SIDE TRACK (S) — runs beside the code

> Owner: **you**. These tasks are about the business and the infrastructure, not the code. Keep them out of the coding sessions.
> Rule: **do not spend more than the time shown on any side task.** If it grows, write it in `docs/15` and ask.
> No cost figures are written here on purpose. Record real quotes in `docs/15`.

### S0 — Before Phase 1 (weeks 0–1)
- ☐ **S-01** (⏱0.5) **Buy the domain.** Keep it forever: the PWA, IndexedDB, and the service worker are tied to the origin. Turn on auto-renew. ✅ Domain in your account, auto-renew on. **⛓ gate for P1-D-03.**
- ☐ **S-02** (⏱0.5) Add the domain to Cloudflare for DNS. ✅ Zone active. **⛓ gate for P1-D-03.**
- ☐ **S-03** (⏱0.5) GitHub organization, repo, and team access (only you at first). ✅ Repo exists. ↔ P0-D-01.
- ☐ **S-04** (⏱0.5) Password manager and project secret store, with separate staging and production entries. ✅ No secret in Git (secret scan in CI, P1-D-02). ↔ P0-D-02.
- ☐ **S-05** (⏱1) Accounts: Sentry, SMS provider (trial), uptime monitor (check whether the free plan fits). ✅ Keys stored in S-04. **⛓ gate for P1-D-03 (Sentry) and P2-B-03 (SMS).**
- ☐ **S-06** (⏱ lawyer's time) Lawyer: brief, reply, drafts of privacy policy and terms (Law 151/2020). This is business advice you get from a lawyer, not from the docs. ✅ Written reply. **⛓ gate for P2-PR-01 and P5-PR-01 (final text).**
- ☐ **S-07** (⏱1.5) Hosting verification and written questions to providers (the ❓ list in `docs/05`). ✅ Table with sources. **⛓ gate for ADR-0006 (P0-D-05).**
- ☐ **S-08** (⏱0.5) Four-month budget from real quotes. ✅ In `docs/15`.

### S1 — Weeks 1–4 (in parallel with Phases 1–2)
- ☐ **S-10** (⏱1) Staging hosting account, Neon project, and billing alerts with a spending cap you choose. ✅ Alerts configured. **⛓ gate for P1-D-03.**
- ☐ **S-11** (⏱0.5) Support channel account (WhatsApp Business) and written support hours. ✅ Channel live before P6-PR-05.
- ☐ **S-12** (⏱ as needed) Native Egyptian Arabic reviewer for UI copy, error messages, empty states, and landing page. ✅ Reviewed lists. ↔ P2-PR-02, P3-PR-03.

### S2 — Weeks 4–8
- ☐ **S-20** (⏱0.5) Set up and verify Vodafone Cash and InstaPay receiving accounts and WhatsApp business contact for manual renewal. ✅ Accounts active.
- ☐ **S-21** (⏱ as needed) Production SMS sender registration if the provider requires it. ✅ Approved. ⛓ before any real shop receives OTP (Phase 6).
- ☐ **S-22** (⏱1) Evaluate a second SMS provider as a backup. ✅ Written comparison in ADR-0007.
- ☐ **S-23** (⏱ borrow or buy) Test devices: two or three phones, including a low-spec Android. ✅ Available. **⛓ gate for P3-F-10.**

### S3 — Weeks 8–12
- ☐ **S-30** (⏱1) Commercial hosting decision and upgrade, before any paying shop. ✅ Plan active. **⛓ gate for P5-D-01 and G0-01.**
- ☐ **S-31** (⏱1) Off-site backup storage (S3-compatible or the provider's), with the encryption key kept in S-04. ✅ First backup restored in a test. **⛓ gate for P5-D-01.**
- ☐ **S-32** (⏱0.5) Cloudflare plan review: WAF, rate limits, SSL strict, HSTS. ✅ Settings noted in `docs/12`. **⛓ gate for P5-D-04.**
- ☐ **S-33** (⏱0.5) Status page account (check the free option). ✅ Page live. **⛓ gate for P7-F-02.**
- ☐ **S-34** (⏱1) Pentest vendor shortlist and budget. ✅ Shortlist in `docs/15`. **⛓ gate for the external part of P5-Q-01.**

### S4 — Launch preparation (weeks 13–16)
- ☐ **S-40** (⏱1) Request quota increases for SMS and AI (requests are slow). ✅ Confirmed in writing. **⛓ gate for P7-D-03.**
- ☐ **S-41** (⏱ if we send email) Sender domain set up with SPF and DKIM through Cloudflare. ✅ Test email arrives, not in spam.
- ☐ **S-42** (⏱0.5) Landing page hosting and privacy-friendly analytics, with consent. ✅ Live. ↔ P7-PR-02.
- ☐ **S-43** (⏱1) Lawyer reviews the landing page claims and the terms. ✅ Written approval. **⛓ gate for P7-PR-02 publish.**

### S5 — Ongoing
- ☐ **S-50** (⏱0.5, then monthly) Renewals calendar (domain, plans, providers) with reminders 30 days before. ✅ Calendar exists.
- ☐ **S-51** (⏱0.5, monthly) Cost per shop review. ✅ Recorded in `docs/15`. ↔ P6-D-03, G5-02.
- ☐ **S-52** (⏱0.5, monthly) Provider status and deprecation check (hosting, database, SMS, AI). ✅ Note in `docs/15`.
- ☐ **S-53** (⏱0.5, quarterly) Restore drill (G5-01). ✅ Result recorded in `docs/runbooks/db-restore.md`. ↔ G0-02.

### What to ignore on purpose (side track)
Multiple domains · a custom email design before launch · paid tools that duplicate what is already free · any side task that is not in this list, until it is written into `docs/15`.

---

# The "what slows or sinks the platform" matrix

| # | Risk | Likelihood | Impact | Proactive action | Where |
|---|---|---|---|---|---|
| 1 | Sync takes longer than planned | High | Very high | Spare time, conflict tests before code, Phase 2 stable before Phase 3 | P2 |
| 2 | Inventory calculation errors | Medium | Very high | Property tests, recompute script | P3 |
| 3 | Data leaks between shops | Low | Catastrophic | RLS, cross-tenant tests in CI | P1 onward |
| 4 | Data loss | Low | Catastrophic | Point-in-time recovery, backups, a tested restore | P5 |
| 5 | Shops stop using it | Medium | High | Interviews, alpha, usage measurement | P0, P6 |
| 6 | Slow lawyer or SMS approval | High | Medium | Start early (S-06, S-05), alternatives | P0, P2 |
| 7 | AI or SMS cost out of control | Medium | Medium | Daily limits, budget, lock | P4 |
| 8 | Poor speed on cheap phones | Medium | High | Early test on a weak device, bundle budget | P3, P5 |
| 9 | Scope creep | High | High | V2 list, "simplicity first" | All |
| 10 | Dependence on one person or provider | Medium | Medium | Documentation, adapters, alternatives | P5+ |
| 11 | Launch with more load than capacity | Medium | High | Gradual launch, feature flag, quotas (S-40) | P7 |
| 12 | Service worker stuck on an old version | Medium | Medium | Update strategy, kill switch | P5 |
| 13 | Agent writes code outside the structure or invents things | Medium | Medium | `AGENTS.md`, reviews, one phase at a time | All |
| 14 | Team burnout | High | High | Small phases, rest after alpha and beta | All |
| 15 | Legal or regulatory problem | Low–Medium | High | Lawyer before production (S-06, S-43), deletion and export | P0, P5 |
| 16 | Free hobby hosting used for paying customers (breaks the terms) | High if ignored | High | Commercial hosting before the first customer (S-30), verify (S-07) | P0, G0 |
| 17 | Free tier burns out fast (polling, egress, compute) | High | Medium | Event-driven sync, aggregates, indicators in `docs/05` section 7 | P2+ |
| 18 | Domain changed after launch (lost installs and local queues) | Medium | High | Domain bought on day one (S-01) | S0 |
| 19 | Shop identity or prices leak through suggestions | Low | Very high | Mandatory leakage test, prices never shared | P4 |
| 20 | Catalog has errors or duplicates | Medium | High | Double review, barcode-only auto-linking, quick hide | P3 |

---

# How to use this file with Antigravity

1. Set up the repo first: **`docs/17-PROJECT-SETUP.md`** (sections 1 to 13).
2. Start the side track's **S0** tasks yourself, the same day (domain, GitHub, secret store, accounts).
3. Paste prompt 0 from `docs/16-AGENT-PROMPTS.md`, and review its summary before any code.
4. Then: **"Implement Phase 1 only, from docs/04-TASKS.md, in order. After each task run the checks and report the real results."**
5. Review each pull request against the task's ✅ condition before you merge.
6. Do not open the next phase until its ✅ is met, and a human has confirmed it.
7. New technical decision → ADR. Conflict with the docs → the agent asks, it does not guess.
8. **Phase 2 (sync) and FEFO in Phase 3:** review these by hand, slowly. They are the riskiest parts.
