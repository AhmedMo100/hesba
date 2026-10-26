# ADR-0001: Project structure (single package, import boundaries)

- **Status:** Proposed
- **Date:** 2026-10-20
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Hesba is built as a single unified application (frontend + server) using Next.js App Router. To prevent architectural erosion and avoid server leaks into browser bundles or client dependencies into database modules, strict folder organization and import boundaries are required (`docs/02-arch.md`).

## Options
1. **Option A: Turborepo / Monorepo with Multiple Packages**
   - *Pros:* Strict package isolation.
   - *Cons:* Heavy tooling overhead, complex deployment and Docker standalone builds, premature complexity for a small core team.
2. **Option B: Single Package with Enforced ESLint Import Boundaries**
   - *Pros:* Simple root package, single tsconfig and lockfile, fast CI, strict compile-time import boundary enforcement using `eslint-plugin-boundaries` (`src/client` ❌ `src/server`, `domain` pure, `schemas` single source of types).
   - *Cons:* Requires discipline and linter enforcement to prevent cross-boundary leaks.

## Decision
We chose **Option B: Single Package with Enforced ESLint Import Boundaries**.
The directory layout consists of `src/app` (routes), `src/client` (browser-only), `src/server` (server-only with `import 'server-only'`), `src/domain` (pure shared logic), and `src/schemas` (Zod schemas). Modules interact across layers only via `index.ts` barrels.

## Consequences
- **Positive:**
  - One dependency tree, fast development, reproducible standalone Docker container.
  - ESLint automatically prevents architectural boundary violations.
- **Negative/risks:**
  - Developers must maintain clean barrel exports and avoid deep cross-directory imports.
- **What must change:**
  - Reflected in `docs/02-arch.md` and ESLint configuration.
- **When to revisit:**
  - Revisit only if independent backend worker services or standalone native apps are added in V2.
