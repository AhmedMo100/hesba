# AGENTS.md — حسبة (Hesba)

> Core rules file for the AI Agent (Antigravity). **Read all of it before any task.** Details are in `docs/`.

## 1. The project in 5 lines

- **Hesba**: a very simple SaaS for managing supermarkets and small shops in Egypt (products, stock with batches and expiry dates, sales, expenses, people, alerts, AI assistant, home screen).
- Used **entirely from a mobile phone**, and works **offline-first** (PWA).
- The UI is **Arabic RTL** (simple Egyptian colloquial). **Simplicity above everything**: any feature that adds a step or clutter is rejected.
- **One Next.js app** (frontend + server). No separate API and no NestJS.
- Visual and behavioral reference: `docs/demo/hesba-demo.html` + its source in `docs/demo/src/`.

## 2. Reading order

1. `docs/00-index.md` (index, reading order, legacy prompt resolver)
2. `docs/01-product.md` (Product Brief, System Design, Roadmap, Decisions)
3. `docs/02-arch.md` (Software Architecture, Folder Structure, Tech Stack)
4. `docs/03-data.md` (Database Schema, Sync Protocol, Catalog & Suggestions)
5. `docs/04-tasks.md` (Tasks phase by phase)
6. `docs/05-ui.md` (UI/UX Specification)
7. `docs/06-quality.md` (Security, Privacy, Testing Strategy)
8. `docs/07-ops.md` (Project Setup, Hosting, Agent Prompts)

**On conflict:** `03-data` wins for schema, sync protocol, and catalog; `07-ops` for hosting and setup; `02-arch` for code details; `01-product` for big decisions and scope. If still conflicting: **ask, don't guess.**

## 3. Inviolable rules

1. **One phase at a time** from `docs/04-tasks.md`. Start with a short plan, implement, run the checks, report the result honestly. Do not move on to the next phase without approval.
2. **The UI never waits for the server** for any core operation: write to Dexie + add an operation to the Outbox. **No periodic polling** (`setInterval` for sync). Sync is event-driven only.
3. **Server Actions for online-only work** (signup, payment, AI, admin). **Sync = Route Handlers**: the fixed, versioned `/api/sync/*` endpoints (`schema_v`). The reason is in `docs/02-arch.md` Part 1.
4. **Every table has `store_id` + RLS** (except the specific global tables listed in `docs/03-data.md`). A new table without RLS is rejected. Every query runs inside `withTenant()`.
5. **Money is integer piasters** (no Float). **Quantities are integers in the base unit** (piece, or gram for weighed items). **Dates are UTC** in the DB and displayed in Cairo time.
6. **Stock = batches + append-only movements.** Sales use FEFO. Undo = a reversing operation (`sale.void`) using `takes`, not a delete.
7. **Every operation is idempotent** via `op_id` (uuid v7 generated on the device). The same operation twice = executed once.
8. **Prices, stock and shop identity are never shared**, ever, in catalog suggestions (`docs/03-data.md`).
9. **Portability:** no provider-locked features (Vercel KV/Blob/Edge Config, Supabase Auth/Realtime). The `Dockerfile` (standalone) must keep building in CI.
10. **No invented numbers, prices or claims**, neither in code nor in marketing copy. Unknown values = a clear constant in `constants.ts` + a comment + log them in `docs/01-product.md` (Decisions/Assumptions).
11. **TypeScript `strict`**, no `any` (unless with a justifying comment). zod in `src/schemas` is the single source of types.
12. **No secrets in code or logs.** No personal data in logs.

## 4. The stack (summary — details in `docs/02-arch.md`)

Next.js (App Router) + TypeScript · Postgres (Neon at first) + Drizzle · Dexie (IndexedDB) · Serwist (PWA) · zod · Vitest + Playwright + fast-check + Testcontainers · Sentry · pnpm · GitHub Actions. Styling: CSS variables from the demo (not Tailwind in V1).

## 5. Structure

One package: `src/app` (routes) · `src/client` (browser only) · `src/server` (server only, starts with `import 'server-only'`) · `src/domain` (pure shared logic) · `src/schemas` (zod) · `drizzle/` (migrations) · `data/catalog/` · `tests/` · `docs/`. **No folders or files outside `docs/02-arch.md` Part 2** without an ADR in `docs/adr/`.
Import boundaries: `src/client` ❌ `src/server`. `domain` and `schemas` stay pure. `pages → features → entities → shared`. A module imports from another module only via `index.ts`.
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
- UI: RTL, mobile-first (320/360/390px), touch targets ≥ 44px, `prefers-reduced-motion`, colors and motion from `docs/05-ui.md` — **don't invent a new design**, port the demo.
- All visible text lives in `src/client/shared/i18n/ar.json` (no text hard-coded in components). Colloquial Arabic: simple and short.
- A big technical decision or a structure change → ADR in `docs/adr/` (the template is there).
- If the task conflicts with the files, or is missing information: **stop and ask** (write the question, the options and your recommendation).

## 8. Prohibitions

- Don't add a new library without a written reason (ADR) — every dependency is a burden.
- Don't do two phases together. Don't make "improvements" outside the task.
- Don't change `schema_v` or the shape of a Sync operation without updating `docs/03-data.md` and supporting the previous version.
- Never delete user data when a subscription ends (read-only instead).
- Don't write a test that passes by mistake (mocks hide RLS/Sync). Integration tests run on a real Postgres.
- Don't claim something was tested when it wasn't.

## 9. Definition of Done

The Phase's Done-when condition is met · checks are green · new tests exist · `docs/` updated if behavior changed · no TODO that isn't logged in `docs/01-product.md` · the UI was tried at 360px and offline (if it has UI).
