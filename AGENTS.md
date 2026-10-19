# AGENTS.md — حسبة (Hesba)

> Core rules file for the AI Agent (Antigravity). **Read all of it before any task.** Details are in `docs/`.

## 1. The project in 5 lines
- **Hesba**: a very simple SaaS for managing supermarkets and small shops in Egypt (products, stock with batches and expiry dates, sales, expenses, people, alerts, AI assistant, home screen).
- Used **entirely from a mobile phone**, and works **offline-first** (PWA).
- The UI is **Arabic RTL** (simple Egyptian colloquial). **Simplicity above everything**: any feature that adds a step or clutter is rejected.
- **One Next.js app** (frontend + server). No separate API and no NestJS.
- Visual and behavioral reference: `docs/demo/hesba-demo.html` + its source in `docs/demo/src/`.

## 2. Reading order
1. `docs/00-START-HERE.md` (index and order)
2. `docs/07-PRODUCT-BRIEF.md` then `docs/08-TECH-STACK.md`
3. `docs/01..03` (System Design / Architecture / Folders)
4. `docs/09-DATABASE-SCHEMA.md`, `docs/10-SYNC-PROTOCOL.md` and `docs/06-CATALOG-AND-SUGGESTIONS.md`
5. `docs/11-UI-UX-SPEC.md`, `docs/12-SECURITY-AND-PRIVACY.md` and `docs/13-TESTING-STRATEGY.md`
6. `docs/17-PROJECT-SETUP.md` (repo setup, once) and `docs/04-TASKS.md` (tasks), `docs/05-HOSTING-...` and `docs/14-ROADMAP-AND-EVOLUTION.md`
7. `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md` (before deciding anything that is still open)

**On conflict:** 09 wins for tables, 10 for the sync protocol, 06 for the catalog, 05 for hosting, 02 for code details, 01 for big decisions. If still conflicting: **ask, don't guess.**

## 3. Inviolable rules
1. **One phase at a time** from `docs/04-TASKS.md`. Start with a short plan, implement, run the checks, report the result honestly. Do not move on to the next phase without approval.
2. **The UI never waits for the server** for any core operation: write to Dexie + add an operation to the Outbox. **No periodic polling** (`setInterval` for sync). Sync is event-driven only.
3. **Server Actions for online-only work** (signup, payment, AI, admin). **Sync = Route Handlers**: the fixed, versioned `/api/sync/*` endpoints (`schema_v`). The reason is in `docs/02` section 2.
4. **Every table has `store_id` + RLS** (except the specific global tables listed in 06 and 09). A new table without RLS is rejected. Every query runs inside `withTenant()`.
5. **Money is integer piasters** (no Float). **Quantities are integers in the base unit** (piece, or gram for weighed items). **Dates are UTC** in the DB and displayed in Cairo time.
6. **Stock = batches + append-only movements.** Sales use FEFO. Undo = a reversing operation (`sale.void`) using `takes`, not a delete.
7. **Every operation is idempotent** via `op_id` (uuid v7 generated on the device). The same operation twice = executed once.
8. **Prices, stock and shop identity are never shared**, ever, in catalog suggestions (06).
9. **Portability:** no provider-locked features (Vercel KV/Blob/Edge Config, Supabase Auth/Realtime). The `Dockerfile` (standalone) must keep building in CI.
10. **No invented numbers, prices or claims**, neither in code nor in marketing copy. Unknown values = a clear constant in `constants.ts` + a comment + log them in `docs/15`.
11. **TypeScript `strict`**, no `any` (unless with a justifying comment). zod in `src/schemas` is the single source of types.
12. **No secrets in code or logs.** No personal data in logs.

## 4. The stack (summary — details in `docs/08`)
Next.js (App Router) + TypeScript · Postgres (Neon at first) + Drizzle · Dexie (IndexedDB) · Serwist (PWA) · zod · Vitest + Playwright + fast-check + Testcontainers · Sentry · pnpm · GitHub Actions. Styling: CSS variables from the demo (not Tailwind in V1).

## 5. Structure
One package: `src/app` (routes) · `src/client` (browser only) · `src/server` (server only, starts with `import 'server-only'`) · `src/domain` (pure shared logic) · `src/schemas` (zod) · `drizzle/` (migrations) · `data/catalog/` · `tests/` · `docs/`. **No folders or files outside `docs/03-FOLDER-STRUCTURE.md`** without an ADR in `docs/adr/`.
Import boundaries: `src/client` ❌ `src/server`. `domain` and `schemas` stay pure. `pages → features → entities → shared`. A module imports from another module only via `index.ts`.

## 6. Commands (names are fixed, created in phase 1)
```
pnpm dev            # development (local Postgres from docker-compose.dev.yml)
pnpm build          # next build (standalone)
pnpm lint           # eslint (includes import boundaries)
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest (unit + property)
pnpm test:int       # integration (Testcontainers) + cross-tenant
pnpm test:e2e       # playwright (offline/sync)
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate     # run migrations (DIRECT_URL)
pnpm catalog:import # data/catalog/*.csv → global_products
```
**Condition for finishing any task:** `lint` + `typecheck` + `test` (+ `test:int` if you touched DB/Sync) all green. Report the actual result; don't say "done" if you didn't run them.

## 7. Working style
- Read the Phase task + its Done-when condition before you start.
- Small PRs (≈400 lines) with tests. Commits in Conventional Commits format.
- UI: RTL, mobile-first (320/360/390px), touch targets ≥ 44px, `prefers-reduced-motion`, colors and motion from `docs/11-UI-UX-SPEC.md` — **don't invent a new design**, port the demo.
- All visible text lives in `src/client/shared/i18n/ar.json` (no text hard-coded in components). Colloquial Arabic: simple and short.
- A big technical decision or a structure change → ADR in `docs/adr/` (the template is there).
- If the task conflicts with the files, or is missing information: **stop and ask** (write the question, the options and your recommendation).

## 8. Prohibitions
- Don't add a new library without a written reason (ADR) — every dependency is a burden.
- Don't do two phases together. Don't make "improvements" outside the task.
- Don't change `schema_v` or the shape of a Sync operation without updating `docs/10` and supporting the previous version.
- Never delete user data when a subscription ends (read-only instead).
- Don't write a test that passes by mistake (mocks hide RLS/Sync). Integration tests run on a real Postgres.
- Don't claim something was tested when it wasn't.

## 9. Definition of Done
The Phase's Done-when condition is met · checks are green · new tests exist · `docs/` updated if behavior changed · no TODO that isn't logged in `docs/15` · the UI was tried at 360px and offline (if it has UI).
