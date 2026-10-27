# ADR-0003: `change_log`: Database Trigger or Application Repository

- **Status:** Proposed
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
The offline-first sync protocol (`docs/03-data.md`) relies on an append-only `change_log` table with a monotonically increasing sequence (`seq BIGSERIAL`). Changes to tenant tables must be recorded in `change_log` with `seq`, `store_id`, `table_name`, `record_id`, `op`, and `patch`. We need to decide whether records are populated automatically via PostgreSQL database triggers or explicitly by application repositories within transactions.

## Options
1. **Option A: PostgreSQL Database Triggers**
   - *Pros:* Guarantees every change is logged regardless of entry point (direct SQL, scripts, or application handlers); impossible to bypass accidentally.
   - *Cons:* Hidden logic inside the database; harder to debug; custom payloads or domain metadata require complex trigger logic or session variable passing.
2. **Option B: Application Repository / Transaction Context**
   - *Pros:* Explicit, type-safe in TypeScript, domain-aware change payloads, easily testable in unit and integration test suites.
   - *Cons:* Every mutation repository must remember to write to `change_log`; potential risk of omissions if raw SQL updates are executed outside the repository.

## Decision
The decision remains **Proposed** (Open decision for Phase 2). The proposed direction is an application repository pattern wrapped in interactive Prisma transactions within `withTenant()`, with a database-level fallback trigger being evaluated.

## Consequences
- **Positive:**
  - Clear trade-off analysis documented before Phase 2 sync implementation.
- **Negative/risks:**
  - Must ensure zero sync desynchronization between client outbox and server change log.
- **When to revisit:**
  - Final decision required during Phase 2 (Sync Engine implementation).
