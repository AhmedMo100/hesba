# حسبة (Hesba) — Data: Database Schema, Sync Protocol, Catalog & Suggestions

> Consolidated data documentation combining:
> - **Part 1: Database Schema (Table Reference)** (formerly `docs/03-data.md`)
> - **Part 2: Sync Protocol (The Exact Contract)** (formerly `docs/03-data.md`)
> - **Part 3: Shared Catalog & Suggestions** (formerly `docs/03-data.md`)

---

# Part 1: Database Schema (Table Reference)
> Source: formerly `docs/03-data.md`

> **This is a reference design.** The source of truth in code is `prisma/schema.prisma` and `prisma/migrations/*.sql`. Any divergence = update this file in the same PR.
> The DDL is approximate (for illustration); the Agent writes it with Prisma plus raw SQL for RLS, indexes, and triggers.

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

### Variants, Inventory, and Services Table List (ADR-0009, ADR-0010)
- `brands`: Master list of commercial product brands shared globally across categories.
- `global_products`: Global catalog base products grouped under a brand and category without store-specific pricing.
- `global_variants`: Global sellable variants of a product defining flavor, size value/unit, packaging pack quantity, and default barcode.
- `store_variants`: Store-specific sellable product variants (linked to a global variant or custom) holding selling price, carton price, low-stock threshold, and barcode.
- `store_stock_batches`: Store inventory batches for a variant holding received quantity, remaining quantity, purchase cost, expiry date, and supplier link.
- `card_serials`: Serialized stock inventory for prepaid telecom/internet recharge scratch cards, with PINs encrypted at rest and sold exactly once.
- `service_items`: Non-stock financial service catalog (bill payments, mobile recharge, Vodafone Cash / InstaPay transfers).
- `commission_rules`: Provider-specific commission fee calculation rules with amount ranges (from_amount, to_amount), fee type (fixed/percent), and fee value.
- `sale_lines`: Individual line items within a sale recording either a physical product variant sold (with batch takes) or a financial service transaction (with amount and calculated commission).

*(Schema definitions and migrations for these tables will be implemented in Phase 3; no SQL written yet).*

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
        -- Subscriptions are renewed manually via Vodafone Cash / InstaPay and extended by admin (ADR-0008)

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
| `brands`, `global_products`, `global_variants` | global | read for the app, write by `hesba_service` |
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
0007_billing_stats   plans, subscriptions, daily_store_stats
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

---

# Part 2: Sync Protocol (The Exact Contract)
> Source: formerly `docs/03-data.md`

> This is the contract between mobile and server. **Any change here = bump `schema_v` and support the previous version** and update this file in the same PR.
> The actual types are defined in `src/schemas/sync.ts` (zod) and shared between client and server.

---

## 1. Principles
1. **Writes are local first** (Dexie), then Outbox, then the server.
2. **Every operation has an `op_id`** (uuid v7 from the device) → **idempotent**.
3. **The server is the final authority** on stock and numbers. Mobile shows an instant estimate.
4. **Ordering:** operations execute in local `seq` order within the same request.
5. **Every operation is an independent Transaction** on the server (one failing doesn't bring down the rest).
6. **No periodic polling.** It is triggered by events (section 7).
7. **The contract is versioned:** `schema_v` in every request. The server supports the current and the previous one.

## 2. The Endpoints

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/api/sync/push` | Send operations | session cookie + `Origin` + `X-Hesba-Client` |
| GET | `/api/sync/pull?cursor=&limit=` | Fetch changes | `204` if nothing new |
| GET | `/api/sync/catalog?cursor=&limit=` | The public catalog | public, ETag + long Cache |
| GET | `/api/sync/bootstrap` | First time on a new device | full snapshot + `cursor` |

### Request headers (Push/Pull)
```
Cookie: <session>                 # httpOnly (the SW sends it by itself, same origin)
X-Hesba-Client: web/<app_version>  # CSRF protection + diagnostics
X-Hesba-Schema: 1                  # the schema_v the client speaks
Content-Type: application/json
```

### Response codes
| Code | Meaning | Client behavior |
|---|---|---|
| 200 | Processed (check each operation's result) | Mark the results |
| 204 | No new changes (pull) | Done |
| 400 | Wrong request shape | Log an error, don't repeat the same request (bug) |
| 401 | Session expired | Show "سجّل دخولك" (Sign in), **the queue stays saved** and local selling continues |
| 403 | Subscription expired/forbidden | Read-only mode; the queue stays saved |
| 409 | Unsupported `schema_v` | "حدّث التطبيق" (Update the app) screen, queue saved |
| 413 | Request too large | Split the batch |
| 429 | Rate limit | Respect `Retry-After` + backoff |
| 503 | Maintenance | `Retry-After`; "السيرفر بيتحدّث، شغلك محفوظ" (The server is updating, your work is saved) |

---

## 3. Push

### The request
```json
POST /api/sync/push
{
  "device_id": "018f…",
  "schema_v": 1,
  "ops": [
    { "op_id": "018f…", "type": "sale.create", "client_ts": "2026-10-17T10:21:00+03:00", "payload": { … } }
  ]
}
```
- Max number of operations per request: **a fixed value in `constants.ts`** (starts with a small value and is tuned after measurement, ❓ depends on the Function timeout of the hosting).
- Max body size: a fixed value. Above it → `413`.

### The response
```json
200
{
  "results": [
    { "op_id": "018f…", "status": "applied",   "ref": { … } },
    { "op_id": "018f…", "status": "duplicate" },
    { "op_id": "018f…", "status": "rejected", "reason": "validation", "details": [ … ] }
  ],
  "server_time": "2026-10-17T07:21:02Z"
}
```
- `applied`: executed. `ref` holds what the server decided (e.g. the final `takes` of a sale operation).
- `duplicate`: the `op_id` was executed before. **Treat it as succeeded.**
- `rejected`: the server rejected it for a reason (section 6). **It is not sent again**; it appears in "محتاج مراجعة" (Needs review).

### Server algorithm (for each operation)
```
withTenant(storeId):
  1) if sync_ops has op_id            → duplicate
  2) zod-validate the payload by type & schema_v   → rejected(validation)
  3) check permissions + active subscription                → rejected(forbidden | subscription)
  4) handler(type) inside the same Transaction      → applied(result) or rejected(domain_reason)
  5) INSERT sync_ops (op_id, status, result)  +  INSERT change_log for each changed entity
```

---

## 4. Operation types (ops) and payloads

> All amounts are `*_minor` (piasters), all quantities are `*_base` (piece or gram). All IDs are uuid v7 from the device.

### 4.1 Products and the catalog
| type | payload | What the server does |
|---|---|---|
| `product.upsert` | `{ id, name, kind, pack_qty?, sell_price_minor, sell_pack_price_minor?, category_id?, barcode?, global_product_id?, custom, low_threshold_base? }` | upsert into `products` (LWW). If `custom` and sharing is enabled → the candidates path (06) |
| `product.delete` | `{ id }` | `deleted_at` (soft). If it has a balance: accepted and an alert is raised |
| `suggestion.accept` | `{ suggestion_id, product_id, sell_price_minor }` | creates `products` linked to the candidate, **price from the store**, `accepts_count++` |
| `suggestion.dismiss` | `{ suggestion_id }` | `dismissed` |
| `suggestion.report` | `{ suggestion_id, reason }` | report + `reports_count++` |

### 4.2 Stock
| type | payload | Effect |
|---|---|---|
| `stock.add` | `{ batch_id, product_id, qty_base, cost_total_minor, expiry_date?, supplier_id?, paid, received_at }` | creates `batches` + a `purchase` movement + updates `stock_levels`. If `paid=false` and `supplier_id` → `suppliers.owed_minor += cost` |
| `stock.waste` | `{ waste_id, product_id, batch_id?, qty_base, reason }` | `waste_records` + a `waste` movement + the batch's `remaining_base` |

### 4.3 Sales
| type | payload | Effect |
|---|---|---|
| `sale.create` | `{ sale_id, lines: [{ line_id, product_id, unit_mode, qty_base, unit_price_minor }] }` | creates `sales` + `sale_lines`, runs **FEFO on the server**, records `takes`/movements, computes the cost. If the balance is short → `negative=true` |
| `sale.void` | `{ sale_id }` | reverses according to the `takes` recorded on the server, `voided_at`. If already voided → `duplicate`-like (`applied` with no effect) |

**Important:** mobile computes estimated `takes` for display, but **the server recomputes them** from the real batch state. The response returns the final `ref.takes`, and the pull brings the updated batches.

### 4.4 Expenses and people
| type | payload |
|---|---|
| `expense.create` | `{ id, category, amount_minor, note?, spent_at }` |
| `expense.delete` | `{ id }` |
| `person.upsert` | `{ id, kind: 'owed_to_me'\|'i_owe', name, phone?, amount_minor, note? }` |
| `person.delete` | `{ id }` |
| `supplier.upsert` | `{ id, name, phone?, owed_minor, product_ids: [] }` |
| `supplier.delete` | `{ id }` |

### 4.5 Settings
| type | payload |
|---|---|
| `store.update` | `{ name?, shop_type?, governorate?, area?, opened_on?, workers_count?, share_custom_products?, receive_suggestions?, settings? }` |
| `alert.dismiss` | `{ kind, ref_id }` |

> **Online-only operations (not Sync):** signup/login/OTP, subscription and payment, the AI question, the admin panel. These are Server Actions.

---

## 5. Pull

### Request and response
```
GET /api/sync/pull?cursor=1042&limit=500
200 {
  "changes": [
    { "seq": 1043, "entity": "product", "id": "…", "op": "upsert", "data": { … } },
    { "seq": 1044, "entity": "expense", "id": "…", "op": "delete" }
  ],
  "next_cursor": 1044,
  "has_more": false
}
204   (nothing new)
```
- The client saves the `cursor`. First time on a device: `bootstrap` then `pull` from the cursor that came back.
- `limit` has a fixed maximum.

### Entities that are downloaded (`entity`)
`store` · `product` · `batch` (with the real `remaining_base`) · `sale` (+ `lines`) · `expense` · `waste` · `person` · `supplier` · `suggestion` · `subscription` (subscription state) · `alert_dismissal`.
**The balance on mobile = the sum of `batches.remaining_base`** (`stock_movements` is not synced).

### The **Rebase** rule (very important)
After the client applies the server's `changes` to Dexie, it must **re-apply the pending operations from the Outbox on top of them, in order**, using the same `src/domain` logic. Otherwise an operation that hasn't been sent yet will be counted twice (once locally and once from the server state) or disappear from the balance.
```
applyPull(changes):
  1) write changes to the local tables (server source)
  2) take all outbox operations with state pending|sending in order
  3) re-apply them locally on the result (domain.apply)
  4) update the screen
```
Mandatory test: a pending local sale + a pull containing a changed batch = the final balance is correct (section 9).

---

## 6. Rejection reasons (`reason`)
| reason | Meaning | Shown to the user |
|---|---|---|
| `validation` | wrong payload | "العملية دي فيها مشكلة" (This operation has a problem) + details |
| `unknown_type` | unsupported operation type | "حدّث التطبيق" (Update the app) |
| `forbidden` | no permission | "مش مسموح" (Not allowed) |
| `subscription` | subscription expired | "الاشتراك خلص" (The subscription ended) (read-only) |
| `not_found` | the entity doesn't exist (e.g. void of a non-existent sale) | "مش لاقي العملية" (Can't find the operation) |
| `conflict` | a conflict we can't resolve automatically | "راجعها" (Review it) |
| `limit` | exceeded a limit (e.g. custom products/day) | "وصلت الحد اليومي" (You reached the daily limit) |
**No silent rejection:** every `rejected` stays visible in "محتاج مراجعة" (Needs review) until the user deals with it (retry after editing, or ignore).

## 7. Operation states on the client
```
pending → sending → applied            (removed from the queue or marked)
                  → duplicate          (same as applied)
                  → rejected           (shown in "محتاج مراجعة")
sending → pending    on network failure/5xx (retry with backoff)
pending → quarantined  after X failed attempts for the same operation (don't block the rest)
```
### When sync runs (events only)
1. After the last local write with a **debounce** (a few seconds, fixed in `constants.ts`).
2. App open.
3. The network comes back (`online`).
4. The tab returns to the foreground (`visibilitychange`).
5. The "زامن دلوقتي" (Sync now) button.
**Forbidden:** periodic `setInterval`. On failure: **exponential backoff + random jitter** (to avoid a sync storm after a mass outage).

## 8. Versions (`schema_v`)
- The server supports the current `schema_v` **and the previous one**. Otherwise `409`.
- A non-breaking change (adding an optional field) doesn't bump the version.
- A breaking change: a new version + a translator (`src/server/modules/sync/versions.ts`) from old to new + a test.
- An old client stored offline after a new deployment **must keep working** (this is the reason we don't use Server Actions for sync).

## 9. Mandatory protocol tests
1. **idempotency:** the same `op_id` twice = one execution, the second response is `duplicate`.
2. **Cut in the middle of a push:** the operation stays pending and is sent again without repeating the effect.
3. **Ordering:** consecutive operations on the same product execute in order.
4. **Two devices:** a sale from both on the same batch → the final balance is correct, and the negative is flagged.
5. **rebase:** a pending sale + a pull with a batch change → the balance is correct.
6. **rejected:** an invalid operation doesn't block the ones after it, and appears in "محتاج مراجعة".
7. **void twice:** no second effect.
8. **401/503/409:** the queue stays saved and continues after recovery.
9. **old schema_v:** an operation in an old format is executed (or a clear 409).
10. **Leak prevention:** no response contains another store's data (cross-tenant).
11. **Storm:** 100 devices coming back at once (Load test) and the 429/Retry-After works.

## 10. Full examples

### Selling a carton + by weight
```json
{ "op_id":"018f-a", "type":"sale.create", "client_ts":"2026-10-17T10:21:00+03:00",
  "payload":{ "sale_id":"018f-s1",
    "lines":[ { "line_id":"018f-l1","product_id":"018f-p1","unit_mode":"pack","qty_base":12,"unit_price_minor":17000 },
              { "line_id":"018f-l2","product_id":"018f-p2","unit_mode":"weight","qty_base":350,"unit_price_minor":32000 } ] } }
```
(A carton = 12 pieces at the carton price of 170 EGP; 350 grams at the per-kilo price of 320 EGP, and the amount is computed as: `qty_base × price / 1000` for weight, with a specific rounding in `domain/money.ts`.)

### Adding goods on credit from a supplier
```json
{ "op_id":"018f-b", "type":"stock.add",
  "payload":{ "batch_id":"018f-b1","product_id":"018f-p5","qty_base":48,"cost_total_minor":120000,
              "expiry_date":"2026-11-02","supplier_id":"018f-v1","paid":false,"received_at":"2026-10-17T09:00:00+03:00" } }
```

### Rejection
```json
{ "op_id":"018f-c","status":"rejected","reason":"validation",
  "details":[ { "path":["payload","qty_base"],"message":"لازم يكون أكبر من صفر" } ] }
```
(The message "لازم يكون أكبر من صفر" means "Must be greater than zero".)

---

# Part 3: Shared Catalog & Suggestions
> Source: formerly `docs/03-data.md`

> The idea: a **public catalog** of the products common in Egyptian supermarkets (we add it manually because there is no API),
> every store can add its own **custom products**, and when one store adds a new product, **the suitable stores** get notified: "There is a product X, want to add it? [إضافة (Add)]".
> A companion file to 02 (Architecture) and 04 (Tasks).

---

## 0. The idea in 6 lines
1. **`global_products`**: the public catalog (readable by everyone, edited by the admin only).
2. **`products`**: the store's products (with price and stock). If the product comes from the catalog → `global_product_id` points to it; if custom → empty.
3. A store can **add a custom product** in seconds (name + unit + price).
4. A custom product is **always recorded in the DB** (this was your request). After an automatic check it becomes a **candidate** (`catalog_candidate`).
5. The candidate reaches **suitable** stores as a suggestion in the alerts: [إضافة (Add)] / [مش محتاج (Not needed)].
6. When enough stores add it (or the admin approves) → it becomes a **public** product in the catalog.

---

## 1. Important decisions (agree on them or change them)

| # | Decision | My suggestion | Why |
|---|---|---|---|
| 1 | **Identity of the store that added it** | **Fully hidden** ("another store"). No name, no area | Privacy + preventing poaching/harassment. Must be written in the Terms (lawyer) |
| 2 | **What is shared** | The product definition only: name, brand, size/unit, category, barcode | Price, stock and sales are **never** shared |
| 3 | **Opt-out option** | The store can say "don't share my custom products" from Settings | Respect for the user + data law |
| 4 | **Who receives the product** | Stores of the **same shop type** (supermarket/grocery/...) that don't have a similar product and haven't rejected it before | Less annoyance and fewer wrong suggestions |
| 5 | **Annoyance limit** | A daily cap per store (adjustable value, e.g. 3) + grouping into one card | "Nothing cluttered" |
| 6 | **Notification** | Inside the app (alerts page + counter). Push optional later (on iOS it needs an installed PWA) | Simplicity + zero cost |
| 7 | **Promotion to a public product** | After **N** acceptances from different stores (N adjustable, starts at 3) **or** admin approval | Prevents chaos |
| 8 | **Duplicate products** | Automatic blocking/merging by barcode and normalized name | A clean catalog |

> **Legal note (to be reviewed with the lawyer):** sharing the product definition between stores + hiding the identity + consent in the Terms.

---

## 2. Data model

```sql
-- كتالوج عام (مقروء للكل، كتابة من الخادم/الإدارة فقط)
-- Public catalog (readable by everyone, written by the server/admin only)
CREATE TABLE global_products (
  id              uuid PRIMARY KEY,              -- uuid v7
  name            text NOT NULL,                 -- as displayed
  name_norm       text NOT NULL,                 -- normalized for search/comparison
  brand           text,
  size_value      numeric, size_unit text,       -- 500 / جم (g)
  category_id     uuid REFERENCES categories(id),
  barcode         text UNIQUE,                   -- optional
  unit_defs       jsonb NOT NULL,                -- units + conversions (piece/carton=12/ ...)
  source          text NOT NULL,                 -- 'seed' | 'promoted'
  status          text NOT NULL DEFAULT 'approved', -- approved | hidden
  catalog_seq     bigint GENERATED ALWAYS AS IDENTITY, -- for incremental sync
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX ON global_products USING gin (name_norm gin_trgm_ops);   -- needs pg_trgm

-- Store products (RLS by store_id)
-- products: id, store_id, global_product_id NULL, custom bool, name, ..., price_minor, deleted_at

-- Catalog candidates (no RLS for stores; server-only access)
CREATE TABLE catalog_candidates (
  id                 uuid PRIMARY KEY,
  submitted_by_store uuid NOT NULL,              -- internal, never shown to any store
  name text NOT NULL, name_norm text NOT NULL, brand text,
  size_value numeric, size_unit text, category_id uuid,
  barcode text, unit_defs jsonb,
  status             text NOT NULL DEFAULT 'pending',
     -- pending | suggestable | approved | rejected | merged | hidden
  accepts_count      int  NOT NULL DEFAULT 0,
  reports_count      int  NOT NULL DEFAULT 0,
  merged_into        uuid REFERENCES global_products(id),
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX ON catalog_candidates (barcode) WHERE barcode IS NOT NULL;

-- Suggestion for a specific store (RLS by store_id)
CREATE TABLE catalog_suggestions (
  id uuid PRIMARY KEY, store_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES catalog_candidates(id),
  status text NOT NULL DEFAULT 'new',            -- new | added | dismissed | reported
  created_at timestamptz DEFAULT now(), acted_at timestamptz,
  UNIQUE (store_id, candidate_id)
);

CREATE TABLE catalog_reports (id uuid PRIMARY KEY, store_id uuid, candidate_id uuid, reason text, created_at timestamptz DEFAULT now());
```
**RLS:** `products`, `catalog_suggestions` by `store_id`. `global_products` is read-only. `catalog_candidates` is locked to stores (server only).

### Normalization (name_norm) — important for Arabic
- Remove diacritics and tatweel (ـ).
- ا/أ/إ/آ → ا · ى → ي · ة → ه (for comparison only).
- Eastern Arabic numerals → Latin.
- Single spaces · lowercase for English.
- Separate the size from the name ("جبنة رومي 500جم" (Roumy cheese 500 g)).
- Put in one shared file `src/domain/normalize.ts` with lots of tests (real examples).

---

## 3. The public catalog: preparing it manually

### Data source (manual, because there is no API)
1. **Market seed CSV files** in `data/catalog/` (template in `data/catalog/template.csv`):
   The market seed is loaded from CSV files in `data/catalog/`. Seed prices are reference only. The shop's own price always wins.
   Columns: `name, brand, size_value, size_unit, category, barcode, carton_qty, reference_price, notes`
2. **Filling rules:** a short, clear name · brand separate · unit/size separate · category from a fixed list · barcode if available (not mandatory).
3. **Double review:** two people review before import (catalog mistakes repeat at every store).
4. **Import:** `scripts/import-catalog.ts` (normalizes, checks duplicates by barcode + `pg_trgm`, and outputs a report of similar items instead of merging blindly).
5. **Periodic update:** a version (`catalog_version`) for each import batch.
6. **Priority:** start with the 300–500 most common products (estimated numbers), and grow according to what stores ask for. Stores that can't find a product use "custom product", and that itself feeds the catalog.

### Catalog sync to mobile (offline)
- Dexie table `global_products` (read-only) + an index on `name_norm`.
- `GET /api/sync/catalog?cursor=<catalog_seq>&limit=1000` (incremental, compressed, CDN cache).
- The first download happens once after signup, then small updates.
- **Offline search:** on `name_norm` (prefix + words) from Dexie; if the list is big, a lightweight search library (ADR).
- Within the budget: the total size and Egress are shared (05 section 7).

---

## 4. Flows

### 4.1 Adding a custom product (on mobile — works offline)
```
1) The store searches ← doesn't find it ← "إضافة منتج جديد" (Add a new product)
2) Types: name (required) + unit + price + (optional) brand/size/category/barcode
3) Quick local match against global_products (barcode or name similarity):
     - strong match ← "Is this the same as: [X]? [أيوه، استخدمه] (Yes, use it) [لأ، منتج مختلف] (No, a different product)"
4) Saved in Dexie as products(custom=true) + an op in the Outbox: product.upsert
5) Price and stock **stay private to the store**
```

### 4.2 On the server (when `product.upsert` for a custom product arrives)
```
1) Save it in products (RLS) ✔  ← always
2) If the store has "sharing" enabled:
     a) automatic check:  name length · not digits only · banned-word list (Arabic/English) · not a duplicate
     b) match against global_products/candidates (barcode → name_norm + pg_trgm):
           strong match ← link it to the existing one (don't create a new suggestion)
           no match ← create catalog_candidates (status='suggestable')
3) Job: choose the suitable stores and create catalog_suggestions (section 4.3)
```

### 4.3 Choosing the receiving stores (a Job in `jobs`)
```
Eligible stores =
   same shop_type
   AND doesn't have a matching product (barcode or close name_norm)
   AND no previous suggestion for the same candidate
   AND has suggestion-receiving enabled
   AND hasn't reached its daily cap yet
Order: most active stores first (last use)  ← limited to a max count per candidate (e.g. 50 stores first, then we increase based on acceptance)
```
**Why a small "first wave"?** If nobody accepts the suggestion, we don't bother thousands of stores. If the acceptance rate is high, we expand.

### 4.4 Notification shape (on the alerts page)
```
┌──────────────────────────────────────┐
│ 🛒 محل تاني بيبيع:                    │   (Another store sells:)
│ «اسم المنتج — الحجم»                  │   («Product name — size»)
│ تحب تضيفه عندك؟                      │   (Want to add it to yours?)
│   [ إضافة ]        [ مش محتاج ]   ⋯بلّغ │   ([ Add ]  [ Not needed ]  ⋯Report)
└──────────────────────────────────────┘
```
- **[إضافة (Add)]:** creates a `products` row for you (linked to the candidate/public one), **price empty**, and opens a "حط سعرك" (Enter your price) field (the price is not transferred), stock zero.
- **[مش محتاج (Not needed)]:** `dismissed` (never comes back).
- **بلّغ (Report):** offensive/wrong product → `reports_count++`.
- All of it works offline: the decision is saved in the Outbox (`suggestion.accept` / `suggestion.dismiss`).
- Grouping: if there is more than one suggestion, a single card "3 منتجات جديدة" (3 new products) that opens up.

### 4.5 Promotion to the public catalog
```
On suggestion.accept: accepts_count++
If accepts_count ≥ N (from different stores)  OR  the admin approved:
     create global_products(source='promoted') + link the candidate (merged)
     Stores that already added it are switched to global_product_id automatically (Job)
If reports_count ≥ K or the admin rejected it: status='hidden'
```

### 4.6 Admin panel (simple, later phase)
`/admin/catalog` (protected by the `platform_admin` role): list of candidates + merge/reject/approve + reports + acceptance statistics. Every operation goes in `audit_log`.

---

## 5. Protection from abuse and annoyance
| Risk | Solution |
|---|---|
| A store floods the catalog with fake products | A daily limit per store + automatic check + the first X products from a new store are reviewed manually |
| Offensive content | Word list + "بلّغ (Report)" button + automatic hiding at K reports |
| Duplicate products | Unique barcode + `name_norm`/`pg_trgm` matching + merging by the admin |
| Annoying stores | Daily cap + same shop type only + small first wave + grouping |
| Revealing the store's identity | The API never returns `submitted_by_store` + a security test verifies it |
| Price manipulation | **Prices aren't shared at all** |
| Dexie abuse (huge catalog) | Size limit + incremental download + no images in V1 |

---

## 6. Performance and cost (related to 05)
- The public catalog: long `Cache-Control` + ETag + cursor → reduces Egress and invocations.
- Choosing the receiving stores: a **batched Job**, not at request time.
- Suggestions for the store: pulled with the regular `pull` (no polling).
- Indexes: `pg_trgm` on `name_norm` + `barcode` UNIQUE.

---

## 7. Required tests
1. Arabic normalization (30+ real examples: hamzas, ya/alef maqsura, ta marbuta, digits).
2. **Leak prevention:** no Endpoint returns the sending store's identity.
3. **RLS:** a store can't see another store's `catalog_suggestions`.
4. Duplicates: the same product from two stores at the same moment (concurrency) = one candidate.
5. Offline: adding a custom product + accepting a suggestion without internet, then syncing.
6. Price: accepting a suggestion **doesn't copy** any price.
7. Limits: daily cap for suggestions and additions.
8. Promotion to the public catalog: reaching N acceptances switches the stores automatically without losing sales/stock.

---

## 8. Risks
| Risk | Impact | Action |
|---|---|---|
| The initial catalog has errors | Repeats at every store | Double review + small batches + `catalog_version` + a quick Hide option |
| Many low-quality suggestions | Stores ignore notifications | First wave + monitoring the acceptance rate + tuning the filters |
| A legal problem with sharing | The feature is stopped | Explicit consent + hidden identity + opt-out option + lawyer review |
| Wrong matching (merging two different products) | Wrong stock/accounts | **We never link automatically except by barcode or a strong match**, and for the rest we ask the user |
| The catalog grew on a weak phone | Slowness | Incremental download + a light index + a limit |

---

## 9. Product notes
- The button name: **"إضافة" (Add)**. ("وصلت" means "the message arrived"; the most suitable for the user is one clear word.)
- After acceptance: a short message "اتضاف. حط سعرك" (Added. Enter your price) with automatic focus on the price field.
- The main products page: a "اقتراحات" (Suggestions) tab next to "المنتجات" (Products) instead of cramming everything into the alerts (possibly an ADR later).
