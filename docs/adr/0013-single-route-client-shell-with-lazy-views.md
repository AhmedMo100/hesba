# ADR-0013: Single Route Client Shell with Lazy-Loaded Views

- **Status:** Accepted
- **Date:** 2026-10-26
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Hesba is designed as an offline-first Progressive Web App (PWA) tailored for Egyptian supermarkets and retail shops operating on mobile devices over slow, metered, or intermittent cellular networks (3G/4G). 

Separating the 8 core application sections (`home`, `products`, `sales`, `stock`, `expenses`, `people`, `alerts`, `ai`) into individual App Router server route segments causes multiple routing contexts, redundant shared layout re-evaluations, and fragmented precaching policies. Conversely, eagerly bundling all 8 views into a single monolithic bundle bloats the First Load JS size on initial application bootstrap.

## Options
1. **Option A: Multi-route App Router (`/app/home`, `/app/products`, etc.)**
   - *Pros:* Standard Next.js server page routing.
   - *Cons:* Slower tab switching, multiple route manifests, higher round-trip latency on poor cellular connections, and complex offline service worker routing.
2. **Option B: Single Catch-All Route Shell (`/app/[[...slug]]`) with Internal Client Router and Lazy-Loaded Views**
   - *Pros:* Fast initial load (only the shell and `HomeView` load eagerly); the remaining 7 views load asynchronously via `React.lazy` inside a Suspense boundary; Serwist precaches all view chunks into `__SW_MANIFEST` so every view opens offline after a single online visit; instant tab switching with URL synchronization.
   - *Cons:* Requires Suspense fallback while a view chunk loads on slow connections.

## Decision
We chose **Option B: Single Catch-All Route Shell (`/app/[[...slug]]`) with Lazy-Loaded Views**.
- The Next.js App Router exposes only `src/app/app/[[...slug]]/page.tsx` for the main application.
- The 8 views reside in `src/client/app-shell/views/<Name>View.tsx`.
- The shell's internal router synchronizes with `window.location.pathname` so `/app` and `/app/<view>` URLs remain fully functional.
- `HomeView` is loaded eagerly. The other 7 views are loaded lazily via `React.lazy` wrapped in a `<Suspense>` boundary displaying `t("common.loading")` from `ar.json`.
- Views are prefetched on initial client mount, and Serwist precaches all view chunks into `public/sw.js` for instant offline accessibility.

## Consequences
- **Positive:**
  - Initial First Load bundle size for `/app` is reduced.
  - Serwist precaches all view chunks in `__SW_MANIFEST`, enabling full offline navigation across all 8 views.
  - Zero hardcoded route strings; views are modular and isolated in `src/client/app-shell/views/`.
  - Offline test `tests/e2e/shell-offline.spec.ts` passes deterministically across desktop and mobile viewports.
- **Negative / Risks:**
  - Dynamic chunk loading errors must be gracefully handled (managed via Next.js and client Suspense/error boundaries).
- **What changed:**
  - `docs/05-ui.md` updated to specify that application sections are internal client views inside the single shell rather than separate routes.
  - Views moved to `src/client/app-shell/views/`.
  - `src/client/pages/` removed.
