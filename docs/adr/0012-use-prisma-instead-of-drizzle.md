# ADR-0012: Use Prisma Instead of Drizzle

- **Status:** Accepted
- **Date:** 2026-10-25
- **Decision-maker:** Hesba Engineering & Owner

## Context
The project previously used Drizzle ORM for database modeling and migrations. To provide a standardized declarative schema definition and robust client generation across environments, the team decided to migrate from Drizzle to Prisma as the primary ORM and schema engine.
Constraints remain strictly non-negotiable:
- Multi-tenancy isolation via PostgreSQL Row Level Security (RLS) with `store_id` on every tenant table.
- Non-superuser application role (`hesba_app`) without `BYPASSRLS`.
- Append-only security grants: `hesba_app` has only `INSERT` and `SELECT` on ledger and financial transaction tables (`wallet_transactions`, `debt_entries`, `purchases`, `sales`).
- Integer math in piasters (`BigInt`) and base units.

## Versions
- `@prisma/client`: `6.4.1` (exact pinned version)
- `prisma`: `6.4.1` (exact pinned version)

## Options
1. **Drizzle ORM** — Close to raw SQL, lightweight, but requires separate manual schema definitions across multiple TypeScript files.
2. **Prisma ORM** — Single declarative `prisma/schema.prisma` modeling all 26 tables, robust migration engine (`prisma migrate`), and interactive transactions supporting PostgreSQL session variables via `tx.$executeRaw\`SELECT set_config('app.store_id', ${storeId}, true)\``.

## Decision
We chose Prisma (`@prisma/client@6.4.1` and `prisma@6.4.1`).
- All 26 tables and enums are modeled in `prisma/schema.prisma`.
- Datasource uses `env("HESBA_DATABASE_URL")` with `directUrl = env("HESBA_DIRECT_URL")`.
- Row Level Security policies, check constraints, partial unique indexes, trigram extension (`pg_trgm`), and role grants/revokes are included as custom SQL in the migration file.
- `withTenant()` is implemented with `prisma.$transaction(async (tx) => { await tx.$executeRaw\`SELECT set_config('app.store_id', ${storeId}, true)\`; return await fn(tx); })`.

## Consequences
- **Positive:**
  - Single declarative schema in `prisma/schema.prisma`.
  - Type-safe auto-generated Client for all models.
  - Seamless migration execution via `prisma migrate deploy`.
- **Negative / Considerations:**
  - Prisma schema DSL does not natively support PostgreSQL `CREATE POLICY`, partial `WHERE` unique indexes, or `CHECK` constraints; these must be maintained as raw SQL in `prisma/migrations/`.
  - Application code uses Prisma Client models and transactions while strictly respecting RLS boundaries.
- **What Changed:**
  - Removed `drizzle/` directory, `drizzle.config.ts`, `src/server/infra/db/schema/`, and Drizzle dependencies.
  - Implemented `prisma/schema.prisma`, initial migration with full RLS and grants, and rewritten `withTenant()` and `tests/integration/cross-tenant.spec.ts`.
