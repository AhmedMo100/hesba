# Hesba — Database Schema (Table Reference)

> **This is a reference design.** The source of truth in code is `src/server/infra/db/schema/*` (Drizzle) and `drizzle/*.sql`. Any divergence = update this file in the same PR.
> The DDL is approximate (for illustration); the Agent writes it with Drizzle plus raw SQL for RLS, indexes, and triggers.

---

## 1. General Rules
1. **IDs:** `uuid` (v7), generated on the device (important for offline). No `serial` for entities.
2. **Money:** `bigint` in piasters (`*_minor`). 1 EGP = 100.
3. **Quantities:** `bigint` in the base unit: **piece** for regular products, **gram** for weighed products (`qty_base`). Showing kilos is a UI-only conversion.
4. **Dates:** `timestamptz` in UTC. `date` for expiry dates and the shop's opening date.
5. **Every table has `store_id`** + RLS (except the global tables in section 9).
6. **Soft delete:** `deleted_at timestamptz NULL` for entities that sync.
7. **`created_at`/`updated_at`** on every table. `updated_at` is refreshed by a trigger.
8. **Every change to a syncable entity** writes a row to `change_log` inside the same transaction.
9. **Naming:** plural `snake_case` for tables, `snake_case` for columns.
10. **Extensions:** `pg_trgm` (catalog search). No provider-specific extensions.

### RLS pattern (for every table with store_id)
```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t>
  USING      (store_id = current_setting('app.store_id', true)::uuid)
  WITH CHECK (store_id = current_setting('app.store_id', true)::uuid);
```
The application user (`hesba_app`) is not the owner, not a superuser, and does not have `BYPASSRLS`. Migrations run as a different user (`hesba_migrator`). Admin roles/jobs that need to bypass RLS use a separate role, `hesba_service`, with a specific list of tables (section 9).

### Enums
```sql
CREATE TYPE product_kind    AS ENUM ('piece','weight');
CREATE TYPE sale_unit_mode  AS ENUM ('piece','pack','weight');
CREATE TYPE movement_type   AS ENUM ('purchase','sale','void','waste','adjust');
CREATE TYPE op_status       AS ENUM ('applied','duplicate','rejected');
CREATE TYPE person_kind     AS ENUM ('owed_to_me','i_owe');
CREATE TYPE sub_status      AS ENUM ('trial','active','past_due','canceled','expired');
CREATE TYPE member_role     AS ENUM ('owner','cashier');
```

---

## 2. Identity and Store

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY, name text NOT NULL,
  phone text NOT NULL UNIQUE,                 -- E.164 or normalized 01xxxxxxxxx
  email text NULL, password_hash text NOT NULL,   -- Argon2id
  phone_verified_at timestamptz NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE stores (
  id uuid PRIMARY KEY, name text NOT NULL,
  shop_type text NOT NULL,                    -- from a fixed list (سوبرماركت/بقالة/... = supermarket/grocery/...)
  governorate text NOT NULL, area text NULL,
  opened_on date NULL, workers_count int NULL,
  share_custom_products boolean NOT NULL DEFAULT true,   -- 06
  receive_suggestions   boolean NOT NULL DEFAULT true,   -- 06
  settings jsonb NOT NULL DEFAULT '{}',       -- custom alert thresholds... (section 8)
  created_by uuid REFERENCES users(id), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE store_members (
  store_id uuid REFERENCES stores(id), user_id uuid REFERENCES users(id),
  role member_role NOT NULL DEFAULT 'owner', created_at timestamptz DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), user_id uuid NOT NULL REFERENCES users(id),
  label text NULL, app_version text NULL, last_seen_at timestamptz, created_at timestamptz DEFAULT now()
);

CREATE TABLE sessions (                       -- cookie sessions (the stored id is hashed)
  id_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  store_id uuid NOT NULL REFERENCES stores(id), device_id uuid REFERENCES devices(id),
  created_at timestamptz DEFAULT now(), last_seen_at timestamptz, expires_at timestamptz NOT NULL,
  rotated_from text NULL, revoked_at timestamptz NULL
);

CREATE TABLE otp_codes (
  id uuid PRIMARY KEY, phone text NOT NULL, purpose text NOT NULL,   -- signup | login | reset
  code_hash text NOT NULL, attempts int NOT NULL DEFAULT 0, ip inet NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz NULL, created_at timestamptz DEFAULT now()
);
CREATE INDEX ON otp_codes (phone, created_at DESC);
```
- `users`, `otp_codes`, `sessions`: **no store_id RLS** (accessed from the server only, via the `hesba_service` role). `store_members`/`devices`: RLS by store.

---

## 3. Catalog and Products (flow details in `06`)

```sql
CREATE TABLE categories (                     -- fixed global list (read-only)
  id uuid PRIMARY KEY, code text UNIQUE NOT NULL, name_ar text NOT NULL, sort int NOT NULL DEFAULT 0
);

CREATE TABLE global_products (                -- global, read-only for the app
  id uuid PRIMARY KEY, name text NOT NULL, name_norm text NOT NULL, brand text NULL,
  size_value numeric NULL, size_unit text NULL, category_id uuid REFERENCES categories(id),
  barcode text UNIQUE NULL, kind product_kind NOT NULL DEFAULT 'piece',
  pack_qty int NULL,                           -- default carton size
  source text NOT NULL,                        -- seed | promoted
  status text NOT NULL DEFAULT 'approved',     -- approved | hidden
  catalog_seq bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON global_products USING gin (name_norm gin_trgm_ops);
CREATE INDEX ON global_products (catalog_seq);

CREATE TABLE products (                       -- the store's products (RLS)
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  global_product_id uuid NULL REFERENCES global_products(id),
  custom boolean NOT NULL DEFAULT false,
  name text NOT NULL, name_norm text NOT NULL, category_id uuid REFERENCES categories(id),
  kind product_kind NOT NULL,                  -- piece | weight
  pack_qty int NULL,                           -- pieces per carton (piece only)
  sell_price_minor bigint NOT NULL,            -- price per piece or per kilo (in piasters)
  sell_pack_price_minor bigint NULL,           -- carton price
  low_threshold_base bigint NULL,              -- overrides the default rule (section 8)
  barcode text NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz NULL
);
CREATE INDEX ON products (store_id, name_norm);
CREATE UNIQUE INDEX ON products (store_id, barcode) WHERE barcode IS NOT NULL AND deleted_at IS NULL;
```
> The purchase price is **not** on the product; it lives on the batches (`batches.cost_total_minor`). Average/last cost are computed.

---

## 4. Inventory (Batches + Movements)

```sql
CREATE TABLE suppliers (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  name text NOT NULL, phone text NULL, owed_minor bigint NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz NULL
);
CREATE TABLE supplier_products (
  store_id uuid NOT NULL, supplier_id uuid NOT NULL REFERENCES suppliers(id),
  product_id uuid NOT NULL REFERENCES products(id), PRIMARY KEY (supplier_id, product_id)
);

CREATE TABLE batches (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL REFERENCES products(id), supplier_id uuid NULL REFERENCES suppliers(id),
  qty_base bigint NOT NULL CHECK (qty_base > 0),          -- quantity received
  remaining_base bigint NOT NULL CHECK (remaining_base >= 0),
  cost_total_minor bigint NOT NULL CHECK (cost_total_minor >= 0),
  expiry_date date NULL,                                   -- NULL = no expiry
  paid boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON batches (store_id, product_id, expiry_date NULLS LAST, received_at) WHERE remaining_base > 0;

CREATE TABLE stock_movements (                -- append-only (no UPDATE, no DELETE)
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL REFERENCES products(id), batch_id uuid NULL REFERENCES batches(id),
  type movement_type NOT NULL, qty_base bigint NOT NULL,       -- + in / − out
  sale_line_id uuid NULL, waste_id uuid NULL, op_id uuid NULL,
  negative boolean NOT NULL DEFAULT false,                     -- outflow without sufficient stock
  created_at timestamptz NOT NULL DEFAULT now(), client_ts timestamptz NULL
);
CREATE INDEX ON stock_movements (store_id, product_id, created_at);

CREATE TABLE stock_levels (                   -- balance cache (updated with every movement)
  store_id uuid NOT NULL, product_id uuid NOT NULL REFERENCES products(id),
  qty_base bigint NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now(), PRIMARY KEY (store_id, product_id)
);

CREATE TABLE waste_records (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  product_id uuid NOT NULL REFERENCES products(id), batch_id uuid NULL REFERENCES batches(id),
  qty_base bigint NOT NULL CHECK (qty_base > 0), cost_minor bigint NOT NULL,
  reason text NOT NULL DEFAULT 'expired',      -- expired | damaged | other
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz NULL
);
```
**Invariants that must hold (tested):**
- `stock_levels.qty_base = SUM(stock_movements.qty_base)` for the product.
- `batches.remaining_base = qty_base + SUM(the batch's movements)`.
- `stock_movements` is never modified or deleted (a trigger prevents it).
- A product's balance can go negative (a sale actually happened); it is flagged `negative=true` and shows up in alerts.

---

## 5. Sales

```sql
CREATE TABLE sales (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), device_id uuid NULL,
  total_minor bigint NOT NULL, cost_minor bigint NOT NULL,       -- cost at time of sale (from the consumed batches)
  op_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL, client_ts timestamptz NULL,
  voided_at timestamptz NULL, void_op_id uuid NULL
);
CREATE INDEX ON sales (store_id, created_at DESC);

CREATE TABLE sale_lines (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id), sale_id uuid NOT NULL REFERENCES sales(id),
  product_id uuid NOT NULL REFERENCES products(id), unit_mode sale_unit_mode NOT NULL,
  qty_base bigint NOT NULL CHECK (qty_base > 0),
  unit_price_minor bigint NOT NULL,            -- the unit price it was sold at (piece/kilo/carton)
  amount_minor bigint NOT NULL, cost_minor bigint NOT NULL,
  takes jsonb NOT NULL                          -- [{batch_id|null, qty_base, negative?}] for an exact void
);
CREATE INDEX ON sale_lines (store_id, product_id);
```
- V1: every sale tap = one `sales` row with one `sale_lines` row. (Both tables are ready for a multi-item basket in V1.1.)
- **Undo (void):** sets `voided_at` and adds reversing `type='void'` movements according to `takes`. Nothing is deleted.
- Reports ignore rows where `voided_at IS NOT NULL`.

## 6. Expenses and People

```sql
CREATE TABLE expenses (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  category text NOT NULL,                      -- كهرباء|نت|إيجار|مرتبات|نقل|صيانة|أخرى (electricity|internet|rent|salaries|transport|maintenance|other)
  amount_minor bigint NOT NULL CHECK (amount_minor > 0), note text NULL,
  spent_at timestamptz NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz NULL
);
CREATE INDEX ON expenses (store_id, spent_at DESC);

CREATE TABLE people (                         -- owed to you / you owe (suppliers are in suppliers)
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  kind person_kind NOT NULL, name text NOT NULL, phone text NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0), note text NULL,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz NULL
);
```

## 7. Sync, Jobs, and Control

```sql
CREATE TABLE change_log (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id uuid NOT NULL, entity text NOT NULL, entity_id uuid NOT NULL,
  op text NOT NULL,                             -- upsert | delete
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON change_log (store_id, seq);     -- partition by month in Stage 3

CREATE TABLE sync_ops (
  op_id uuid PRIMARY KEY, store_id uuid NOT NULL, device_id uuid NULL,
  type text NOT NULL, schema_v int NOT NULL,
  status op_status NOT NULL, reason text NULL, result jsonb NULL,
  client_ts timestamptz NULL, received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sync_ops (store_id, received_at);   -- periodic cleanup of rows older than X days (Job)

CREATE TABLE jobs (
  id uuid PRIMARY KEY, type text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
  run_at timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'pending',       -- pending | running | done | dead
  locked_until timestamptz NULL, last_error text NULL, created_at timestamptz DEFAULT now(), done_at timestamptz NULL
);
CREATE INDEX ON jobs (status, run_at);

CREATE TABLE flags (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT now());  -- maintenance, kill-switch
CREATE TABLE audit_log (id uuid PRIMARY KEY, store_id uuid NULL, actor_user_id uuid NULL, action text NOT NULL, target text NULL, meta jsonb NULL, ip inet NULL, created_at timestamptz DEFAULT now());
CREATE TABLE ai_usage (store_id uuid NOT NULL, day date NOT NULL, count int NOT NULL DEFAULT 0, PRIMARY KEY (store_id, day));
CREATE TABLE alert_dismissals (store_id uuid NOT NULL, kind text NOT NULL, ref_id uuid NOT NULL, dismissed_at timestamptz DEFAULT now(), PRIMARY KEY (store_id, kind, ref_id));
```
- `ai_usage`: atomic check `INSERT … ON CONFLICT (store_id, day) DO UPDATE SET count = ai_usage.count + 1 WHERE ai_usage.count < 5 RETURNING count` (if no row is returned = the limit is reached). The limit of 5 is a constant in `constants.ts`.

## 8. Subscriptions and Reports

```sql
CREATE TABLE plans (id uuid PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, interval text NOT NULL, price_minor bigint NULL, active boolean DEFAULT true);
        -- price_minor is set after the actual cost is calculated (no invented numbers)
CREATE TABLE subscriptions (
  store_id uuid PRIMARY KEY REFERENCES stores(id), plan_id uuid REFERENCES plans(id),
  status sub_status NOT NULL DEFAULT 'trial', trial_ends_at timestamptz, current_period_end timestamptz,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE payments (
  id uuid PRIMARY KEY, store_id uuid NOT NULL REFERENCES stores(id),
  provider text NOT NULL, provider_ref text NOT NULL, amount_minor bigint NOT NULL,
  status text NOT NULL, raw jsonb NULL, created_at timestamptz DEFAULT now(),
  UNIQUE (provider, provider_ref)               -- idempotency for webhooks
);

CREATE TABLE daily_store_stats (               -- aggregate table updated by jobs
  store_id uuid NOT NULL, day date NOT NULL,
  sales_total_minor bigint NOT NULL DEFAULT 0, sales_count int NOT NULL DEFAULT 0,
  cogs_minor bigint NOT NULL DEFAULT 0, expenses_minor bigint NOT NULL DEFAULT 0, waste_minor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (store_id, day)
);
```
- **Default alert thresholds** (from the demo; can be overridden via `products.low_threshold_base` or `stores.settings`):
  - Weighed product: "running low" if `< 3000 g`.
  - Product with a carton: if `< 2 × pack_qty`.
  - Otherwise: if `< 10 pieces`.
  - "Out of stock" if `<= 0`. "Near expiry": a batch with `remaining > 0` whose expiry is within **7 days** or less.

## 9. Shared Catalog Tables (details in `06`)
`catalog_candidates` (server-only, no store RLS) · `catalog_suggestions` (RLS by store_id) · `catalog_reports`.

### Tables without `store_id` RLS (an explicit list; any other table without it = rejected)
| Table | Reason | Access |
|---|---|---|
| `users`, `otp_codes`, `sessions` | identity | `hesba_service` (server) only |
| `categories`, `plans` | global | read for the app |
| `global_products` | global | read for the app, write by `hesba_service` |
| `catalog_candidates`, `catalog_reports` | internal | `hesba_service` only |
| `jobs`, `flags` | operations | `hesba_service` only |
| `stores` | one store per user/membership | RLS policy on `store_members` (or `id = app.store_id`) |

## 10. Migration Order (proposed)
```
0001_init            users, stores, store_members, devices, sessions, otp_codes + DB roles
0002_rls_policies    policies + the test
0003_catalog         categories, global_products, products + pg_trgm
0004_inventory_sales suppliers, batches, stock_movements, stock_levels, waste_records, sales, sale_lines
0005_misc            expenses, people, alert_dismissals, ai_usage
0006_sync_jobs       change_log, sync_ops, jobs, flags, audit_log
0007_billing_stats   plans, subscriptions, payments, daily_store_stats
0008_suggestions     catalog_candidates, catalog_suggestions, catalog_reports
```
Every migration: Expand/Contract, tried on a copy of real data, and shipped with an RLS test.

## 11. Critical Query Examples
```sql
-- FEFO: available batches for a product (inside withTenant)
SELECT id, remaining_base FROM batches
WHERE product_id = $1 AND remaining_base > 0
ORDER BY expiry_date NULLS LAST, received_at
FOR UPDATE;

-- pull
SELECT seq, entity, entity_id, op FROM change_log
WHERE store_id = $1 AND seq > $2 ORDER BY seq LIMIT $3;

-- balance (verification)
SELECT COALESCE(SUM(qty_base),0) FROM stock_movements WHERE product_id = $1;
```
