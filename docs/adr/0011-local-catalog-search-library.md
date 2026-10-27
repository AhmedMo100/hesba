# ADR-0011: Local catalog search library

- **Status:** Proposed
- **Date:** 2026-10-26
- **Decision-maker:** Ahmed Tarek / Core Team

## Context
In Hesba, product search must function 100% offline on low-end mobile devices across 5,000+ catalog items. Search needs to support Arabic normalized prefix search, typo tolerance, and fast response times (<50ms) without lagging the UI thread.
Constraints:
- Offline-first execution inside IndexedDB (Dexie).
- Arabic normalization (`src/domain/normalize.ts`).
- Minimal bundle size budget (<30KB for search library).

## Options
1. **MiniSearch** — Pure JS in-memory index, supports prefix and fuzzy search, lightweight (~7KB gzipped).
2. **Dexie compound indexing with normalized prefixes** — Zero added dependencies, uses native IndexedDB B-tree indexes, exact prefix matching only.
3. **FlexSearch** — Fast memory index, larger footprint, custom tokenizer required for Arabic.

## Decision
Proposed: Evaluate MiniSearch or native Dexie normalized prefix indexing during Phase 3 (Task P3-F-12) based on real device memory benchmarks on budget Android devices.

## Consequences
- Positive: Clear offline catalog search strategy without committing to unnecessary bundle bloat early.
- Negative/risks: In-memory indexes require initial load time from IndexedDB into memory on app launch.
- What must change: Revisit and benchmark during Phase 3.0 (Task P3-F-12).
- When to revisit: Start of Phase 3.
