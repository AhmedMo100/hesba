---
name: rls-tenancy
description: Multi-tenant data isolation using PostgreSQL Row Level Security (RLS), withTenant transaction context, and cross-tenant tests.
---

# RLS & Multi-Tenancy Skill

## When to Use

- Adding, modifying, or deleting database tables in `drizzle/` or `src/server/db/schema/`.
- Writing or reviewing server actions, API route handlers, repositories, or background jobs.
- Writing integration tests (`pnpm test:int`) that touch database queries.

## Core Rules & Principles

1. **Tenant Isolation by Default**: Every store's data is strictly isolated. A leak between stores is a catastrophic security failure.
2. **Every Table Has `store_id`**: Every tenant-scoped table MUST include `store_id UUID NOT NULL REFERENCES stores(id)` and have Row Level Security enabled (`ENABLE ROW LEVEL SECURITY`).
3. **Global Tables Exemption**: Only global lookup tables without tenant boundaries (such as `global_products`, `plans`, and system migrations) are exempt from `store_id`.
4. **Non-Bypass Database User**: The runtime application database user MUST NOT be a superuser and MUST NOT have `BYPASSRLS`. (Only schema migrations execute with `DIRECT_URL`).
5. **No Queries Outside `withTenant`**: All tenant database operations MUST be wrapped in `withTenant(storeId, userId, fn)`. Direct unwrapped queries against tenant tables are strictly forbidden.

## Implementation Steps

### 1. Drizzle Schema & Table Setup

In `src/server/db/schema/`:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { stores } from "./stores";

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
```

### 2. SQL RLS Policy (in Migration)

Every tenant table must have an RLS policy checking `current_setting('app.store_id', true)`:

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

CREATE POLICY products_store_isolation ON products
  FOR ALL
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
```

### 3. Executing Queries with `withTenant`

In `src/server/db/tenant.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "./index";

export async function withTenant<T>(
  storeId: string,
  userId: string | null,
  fn: (tx: typeof db) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.store_id', ${storeId}, true)`);
    if (userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    return await fn(tx);
  });
}
```

### 4. Writing the Cross-Tenant Integration Test

Every endpoint or service must have a cross-tenant test:

1. Seed Tenant A (`storeA`) and Tenant B (`storeB`).
2. Insert a record under `storeA`.
3. Switch session / context to `storeB` and attempt:
   - `SELECT`: returns empty array (or 404).
   - `UPDATE`: 0 rows updated (or 404).
   - `DELETE`: 0 rows deleted (or 404).
   - `INSERT`: cannot insert with `storeA`'s ID while context is `storeB`.

## Mandatory Checks

- [ ] Does every new table (except global tables) have `store_id`?
- [ ] Is RLS enabled on the table (`ENABLE ROW LEVEL SECURITY`)?
- [ ] Is the query wrapped in `withTenant`?
- [ ] Does a cross-tenant test exist in `tests/int/` confirming Tenant B cannot read/modify Tenant A's data?
- [ ] Does `pnpm test:int` pass on real PostgreSQL via Testcontainers?

## Documentation Links

- [docs/03-data.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/03-data.md) — Database schema, tenant tables, and RLS definitions.
- [docs/06-quality.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/06-quality.md) — Security boundaries, RLS verification, and cross-tenant testing.
- [docs/02-arch.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/02-arch.md) — Server architecture and data access boundaries.
