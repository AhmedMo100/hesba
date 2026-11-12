# ADR-0017: Production folder structure and module shape

- **Status:** Proposed
- **Date:** 2026-11-08
- **Decision-maker:** Project owner (approval pending)

## Context

The Production Architecture Audit (2026-11-08) compared `docs/02-arch.md` Part 2 with the real code:

- `src/client/app-shell/views/` holds 18 view/modal files (201–2,027 lines) in one flat folder, plus a fetch module (`customTaxonomy.ts`). `src/client/shared/machines.ts` is a feature API client sitting in `shared/`.
- The documented client layering `pages → features → entities → shared` was never built. The code has only `app-shell/` and `shared/`.
- The documented server module layout (`actions.ts`, `handlers.ts`, `app/`, `domain/`, `infra/`) was never built. Modules are flat `*.service.ts` files that call Prisma directly. There is no Server Action anywhere; every server entry point is a Route Handler.
- Sales, promotions and alerts have no server module. Their business logic and Prisma calls live in `src/app/api/*/route.ts`.
- AI vendor adapters (Gemini, Brave) live inside `modules/ai/` rather than `infra/`.

AGENTS.md §5 requires an ADR for any structure that differs from Part 2.

## Options

1. **Build the documented three-layer client and the five-folder server module.** Matches the docs. Doubles the number of folders for an app of this size, and most `entities/` and `handlers.ts` folders would be empty until the sync engine exists.
2. **Keep the current flat layout.** No churn. Leaves the god-folders and route-embedded business logic in place.
3. **One feature layer on the client, a flat but consistent module shape on the server.** Less ceremony than option 1, and fixes the ownership problems in option 2.

## Decision

Option 3.

**Client**
```
src/client/
  app-shell/            Shell, Header, SideNav, BottomNav, SyncBar, lazy view registry
  features/<feature>/   Everything one screen owns: its view and modals
                        (home, sales, products, stock, people, expenses, alerts, ai, auth)
  offline/              Dexie database and catalog sync. The outbox and sync engine will live here.
  shared/               Code used by two or more features: ui, styles, hooks, i18n, theme,
                        api (HTTP clients: auth, machines, custom taxonomy), store-items (shared row types)
```
- A feature may import from `shared/`, `offline/`, `@/domain` and `@/schemas`.
- Types, helpers and API clients needed by two or more features live in `shared/`, never inside another feature.
- A feature may render another feature's **modal component**, imported by its file path. The current cases are:
  - `stock/AddStockModal`, used by products and alerts
  - `stock/MachineTopupModal`, used by alerts
  - `alerts/EditPromoModal`, used by sales
  - `products/ProductFormModal`, used by stock

  Barrel `index.ts` re-exports are deliberately not used for components. Webpack treats a component module that imports CSS as side-effectful, so a barrel would pull every modal into every lazy view chunk.
- `offline/` must not import from `features/` or `app-shell/`.
- Machine (POS) management has no feature of its own. `MachinesModal` and `ServiceFormModal` live in `products/`, which opens them and owns their styles. `MachineTopupModal` (digital stock balance) lives in `stock/`.

**Server module**
```
src/server/modules/<module>/
  index.ts              The module's only public API (starts with import "server-only")
  <name>.service.ts     Use cases. Owns the transaction boundary (withTenant).
  <name>.repo.ts        Optional. Prisma queries, extracted when a service grows past one responsibility.
  domain/ or *.ts       Optional. Pure, module-private rules. Shared rules go to src/domain.
```
- Route Handlers stay thin: zod parse → session → one call into a module's `index.ts` → response.
- Vendor adapters live in `src/server/infra/<capability>/` (`db`, `crypto`, `email`, `ai`). Modules depend on the adapter interfaces. `infra/ai/contracts.ts` holds both the LLM and the web-search interfaces in one file, because the two are small and only the AI module uses them.
- Route Handlers remain the server entry point. Server Actions are not adopted by this ADR. That question is still open (audit §24 #2).

## Consequences

- Positive: each screen's code is in one folder. Business logic leaves `src/app`. The module public API is explicit, which makes the ESLint boundary rules enforceable.
- Negative/risks: a large rename diff. Mitigation: moves happen in their own batches with no logic edits, and lint, typecheck, unit, integration and build run after each batch.
- What must change: `docs/02-arch.md` Part 1 §3.2 and §4.1, and Part 2 §3 and §4.
- What this ADR does **not** decide (still open, audit §24): password vs passkey auth, Server Actions, the `hesba_service` role, sync-engine timing, the rate-limiter store, file removals.
- When to revisit: if a single feature folder grows past roughly 10 files, or if the sync engine needs per-entity client models (`entities/`).
