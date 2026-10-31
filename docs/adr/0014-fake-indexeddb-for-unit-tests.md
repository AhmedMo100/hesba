# ADR-0014: fake-indexeddb for Unit Testing Dexie in Node

- **Status:** Accepted
- **Date:** 2026-10-28
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
Hesba is built with an offline-first architecture using Dexie (IndexedDB) as the primary client database (`src/client/shared/db/`).
Task P2-F-03 requires automated unit and migration tests verifying:
1. All local synced tables and schema definitions.
2. Version upgrade migrations from version 1 to version 2 without data loss.
3. Strict integer storage for money (`*_minor` piasters) and inventory quantities (`*_base`).

Running Vitest in a Node.js environment lacks a native `indexedDB` global object. 

## Options
1. **Option A: Test Dexie exclusively in Playwright E2E browser tests**
   - *Pros:* Uses real Chromium/WebKit IndexedDB.
   - *Cons:* Slow feedback loop (seconds instead of milliseconds per test run), heavy overhead for testing schema migrations and column constraints.
2. **Option B: Add `fake-indexeddb` as a devDependency for Vitest**
   - *Pros:* High-performance in-memory IndexedDB implementation, zero production bundle impact, runs standard Dexie schema upgrade tests in Vitest in <100ms.
   - *Cons:* Adds one development dependency (`fake-indexeddb`).

## Decision
We chose **Option B: Add `fake-indexeddb` as a devDependency**.
It is imported exclusively in test setup / unit test files (`tests/unit/client/db-upgrade.spec.ts`) to provide an in-memory `indexedDB` implementation for fast, deterministic unit testing.

## Consequences
- Fast unit test execution for IndexedDB operations in Vitest.
- Zero footprint on production bundles or runtime dependencies.
