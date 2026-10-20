# ADR-0002: Use Webpack for build and dev because Serwist needs it

- **Status:** Proposed
- **Date:** 2026-10-20
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Next.js 16 defaults to Turbopack for both `next dev` and `next build`. However, Hesba's offline-first PWA architecture relies on `@serwist/next` to bundle the service worker (`src/app/sw.ts` → `public/sw.js`) during development and production builds.

`@serwist/next` operates via a Webpack plugin and does not currently support Turbopack natively. Attempting to run `next build` or `next dev` with Turbopack results in build failures or uncompiled service workers.

Additional environment decisions established during setup:
1. **Local Postgres Host Port 5434**: The host machine already runs native PostgreSQL (version 18) on default port `5432` and an existing container on `5433`. Binding Docker's host port to `5432` causes `bind: address already in use`. Therefore, local development maps host port `5434` to container port `5432` via `${HESBA_POSTGRES_PORT:-5432}:5432`, configured in `.env.local` as `HESBA_POSTGRES_PORT=5434`.
2. **Node >=22**: Mandated by project stack specifications (`docs/08-TECH-STACK.md` and `docs/17-PROJECT-SETUP.md`) to utilize native Node features (native WebSocket, crypto, fetch, v22 LTS performance and security).
3. **pnpm 10.20.0 pinned**: Pinned via `"packageManager": "pnpm@10.20.0"` to guarantee deterministic dependency resolution across team environments, Docker container builds, and CI workflows.
4. **`agentRules: false` in `next.config.ts`**: Next.js 16 introduced an automatic feature that appends agent instructions directly to repository root files (such as `AGENTS.md`). Setting `agentRules: false` preserves `AGENTS.md` integrity and prevents Next.js CLI processes from mutating project guidelines.

## Options
1. **Option A: Use Webpack via `--webpack` flag in Next.js scripts (`next dev --webpack`, `next build --webpack`)**
   - Pros: Directly supported by `@serwist/next`; guarantees service worker generation and PWA precaching; zero custom bundler hacks; reproducible in Docker standalone builds.
   - Cons: Slightly slower cold compilation compared to Turbopack, though negligible for the current application scope.
   - Cost: Zero extra dependencies.

2. **Option B: Turbopack with standalone custom service worker compilation script (e.g., separate esbuild or rollup step)**
   - Pros: Keeps Turbopack for page compilation.
   - Cons: Introduces external build steps, increases maintenance burden, desynchronizes Next.js asset manifest from service worker precache manifest, and breaks the standard single-app build pipeline.
   - Cost: Extra build scripts, dev tooling dependencies, and higher bug surface.

## Decision
We chose **Option A: Use Webpack (`--webpack`) for build and dev** because Serwist requires Webpack plugins to inject build manifests into the service worker. Preserving offline PWA reliability is paramount for Hesba.

We also recorded the following setup parameters:
- Local PostgreSQL host port mapped to `5434` in `.env.local` via `HESBA_POSTGRES_PORT=5434` to avoid host port collisions while keeping internal container port `5432`.
- Node `>=22` LTS engine restriction in `package.json`.
- `pnpm 10.20.0` pinned in `package.json` `packageManager`.
- `agentRules: false` kept in `next.config.ts` to prevent automated mutations of `AGENTS.md`.

## Consequences
- Positive:
  - Service worker builds seamlessly on every `pnpm dev` and `pnpm build`.
  - Docker standalone image builds cleanly in CI and local Docker.
  - No port conflicts with existing developer databases.
  - Project documentation and agent guidelines remain immutable and pristine.
- Negative/risks:
  - Webpack compilation time in development is slightly higher than Turbopack.
- What must change (docs files, tasks in 04):
  - Documented in `docs/adr/0002-use-webpack-for-build-and-dev-because-serwist-needs-it.md`.
  - Recorded in `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md`.
  - Noted in `.env.example` regarding `HESBA_POSTGRES_PORT`.
- When to revisit the decision (measurement indicator):
  - Revisit when `@serwist/next` (or Next.js native PWA support) provides stable first-party Turbopack integration.
