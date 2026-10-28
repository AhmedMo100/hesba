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
  email text NOT NULL,                        -- required for account recovery and email verification
  email_verified_at timestamptz NULL,         -- verified email timestamp
  phone_verified_at timestamptz NULL,
  password_hash text NULL,                    -- deprecated (nullable, kept for migration compatibility, dropped in 2.2 cleanup)
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
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

-- Passkeys (WebAuthn credentials for passwordless primary authentication)
CREATE TABLE user_passkeys (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text UNIQUE NOT NULL,         -- base64url encoded WebAuthn credential ID
  public_key bytea NOT NULL,                  -- COSE public key bytes
  counter bigint NOT NULL DEFAULT 0,          -- replay prevention counter
  device_name text NOT NULL DEFAULT 'جهاز',   -- friendly label ("هاتف آيفون", etc.)
  aaguid text NULL,                           -- authenticator AAGUID
  transports text[] NOT NULL DEFAULT '{}',    -- internal, hybrid, usb, nfc, ble
  backup_eligible boolean NOT NULL DEFAULT false,
  backup_status boolean NOT NULL DEFAULT false,
  last_used_at timestamptz NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON user_passkeys (user_id, created_at DESC);

-- WebAuthn Challenges (single-use, short-lived 5-minute cryptographic challenges)
CREATE TABLE passkey_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users(id) ON DELETE CASCADE, -- null for autofill/pre-login
  challenge text UNIQUE NOT NULL,             -- 32+ bytes base64url random challenge
  purpose text NOT NULL,                      -- registration | authentication | reauth
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON passkey_challenges (challenge);
CREATE INDEX ON passkey_challenges (expires_at);

-- Email Verification Tokens (single-use, 24h, hashed)
CREATE TABLE email_verification_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,            -- SHA-256 hash of single-use URL token
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON email_verification_tokens (token_hash);

-- Account Recovery Tokens (single-use, 1h, hashed, emergency fallback when passkeys are lost)
CREATE TABLE account_recovery_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,            -- SHA-256 hash of single-use URL token
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX ON account_recovery_tokens (token_hash);

-- NOTE: otp_codes table is OBSOLETE and removed.
-- MIGRATION CLEANUP PLAN (Phase 2.2):
-- Initial migration 20261025000000_init defined users.password_hash and otp_codes.
-- In Phase 2.2, a new migration will:
-- 1. Alter users.password_hash to nullable or drop it.
-- 2. Add users.email_verified_at.
-- 3. Create user_passkeys, passkey_challenges, email_verification_tokens, account_recovery_tokens.
-- 4. Drop table otp_codes.
```
- `users`, `user_passkeys`, `passkey_challenges`, `email_verification_tokens`, `account_recovery_tokens`, `sessions`: **no store_id RLS** (accessed from the server only, via the `hesba_service` role). `store_members`/`devices`: RLS by store.

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
| `users`, `user_passkeys`, `passkey_challenges`, `email_verification_tokens`, `account_recovery_tokens`, `sessions` | identity | `hesba_service` (server) only |
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
> Source: formerly `docs/10-SYNC-PROTOCOL.md`, consolidated into `docs/03-data.md`

> This is the authoritative contract between mobile (Dexie Outbox) and server (Route Handlers).
> **Any change here = bump `schema_v`**, provide backwards compatibility for $N-1$ versions, and update this specification in the same PR.
> The runtime schemas are defined in `src/schemas/sync.ts` (zod) and shared between client and server.

---

## 1. Principles

1. **Local-First (Dexie):** Writes execute locally into Dexie tables first, queue into the Outbox, and sync asynchronously.
2. **Idempotent Mutations:** Every operation carries an immutable `op_id` (UUID v7 generated on the device). The same operation received twice executes exactly once; the second request returns `duplicate`.
3. **Authoritative Server Invariants:** The server is the final authority on stock batch depletion (FEFO algorithm) and financial accounting. The client calculates optimistic estimates for immediate UI feedback and adjusts upon receiving the server's authoritative `ref.takes`.
4. **Local Sequence Ordering:** Operations within a push batch execute sequentially in the exact `client_ts` / local sequence order generated by the client.
5. **Per-Operation Transaction Isolation:** Every operation executes within an independent PostgreSQL transaction inside `withTenant(storeId)`. A failure or rejection of one operation does not roll back preceding or subsequent operations in the batch.
6. **Strict Tenant Isolation:** Every query and mutation runs within `withTenant(storeId)`. Operations targeting cross-tenant entities are rejected with HTTP 403 / `forbidden`. Shared catalog data is strictly quarantined from shop-specific prices, costs, and stock.
7. **No Periodic Polling:** Sync is purely event-driven (Section 7). Using `setInterval` anywhere in the sync engine is strictly forbidden.
8. **Explicit Schema Versioning:** Every request and response declares `schema_v`. The server supports the active version ($N$) and the immediate predecessor ($N-1$). Clients with deprecated versions receive HTTP 409 Conflict.
9. **Offline Resilience & Queue Preservation:** An expired session or server error during offline operation never interrupts local selling. The Outbox queue remains persisted in IndexedDB, and authentication is requested upon network reconnection.

---

## 2. Endpoints and Headers

| Method | Path | Purpose | Auth & Validation |
|---|---|---|---|
| POST | `/api/sync/push` | Submit queued Outbox operations | Session cookie + `Origin` + `X-Hesba-Client` + `X-Hesba-Schema` |
| GET | `/api/sync/pull?cursor=&limit=` | Fetch delta entity changes | Session cookie + cursor validation (`204` if empty) |
| GET | `/api/sync/catalog?cursor=&limit=` | Download public catalog delta | Public endpoint, ETag + Cache-Control |
| GET | `/api/sync/bootstrap` | Initial state download for new/reset device | Session cookie, full tenant snapshot + initial cursor |

### Request Headers
```http
Cookie: <session>                  # httpOnly rotating session cookie
X-Hesba-Client: web/<app_version>   # Client identifier & CSRF protection
X-Hesba-Schema: 1                   # Client schema_v integer
Content-Type: application/json
```

### HTTP Response Codes
| Code | Meaning | Standard Error Envelope | Client Behavior |
|---|---|---|---|
| **200** | Processed successfully | None (per-operation results in body) | Inspect individual operation results (`applied`, `duplicate`, `rejected`) |
| **204** | No new changes (pull) | None | Pull complete; cursor remains at current value |
| **400** | Malformed request body / JSON | `{ error: { code: "BAD_REQUEST", message, details } }` | Bug in payload serialization. Log to Sentry; do not retry unaltered batch |
| **401** | Session expired / unauthenticated | `{ error: { code: "SESSION_EXPIRED", message: "سجّل دخولك" } }` | Display login banner. **Outbox queue remains safely preserved**; local selling continues |
| **403** | Forbidden / tenant mismatch / suspended | `{ error: { code: "FORBIDDEN", message: "مش مسموح" } }` | Enter read-only mode; queue preserved |
| **409** | Unsupported `schema_v` | `{ error: { code: "SCHEMA_VERSION_UNSUPPORTED", message: "حدّث التطبيق", details: { client_v, min_v, current_v } } }` | Show persistent "حدّث التطبيق" (Update app) modal; halt sync timer; **preserve queue** |
| **413** | Batch exceeds size limit | `{ error: { code: "PAYLOAD_TOO_LARGE", message } }` | Split Outbox batch into smaller chunks (e.g. halved) and retry |
| **429** | Rate limited | `{ error: { code: "RATE_LIMITED", message } }` | Respect `Retry-After` header + jittered exponential backoff |
| **503** | Maintenance mode (`flags.maintenance`) | `{ error: { code: "MAINTENANCE_MODE", message: "السيرفر بيتحدّث، شغلك محفوظ" } }` | Respect `Retry-After`; queue preserved; retry automatically when window expires |

### Standard Error Response Envelope
All HTTP 4xx and 5xx responses across `/api/sync/*` follow the canonical error envelope:
```json
{
  "error": {
    "code": "HesbaErrorCode",
    "message": "رسالة واضحة باللهجة المصرية",
    "details": {}
  }
}
```

---

## 3. Push Protocol

### 3.1 Push Request
```json
POST /api/sync/push
{
  "device_id": "018f3a5b-7c8d-7e0f-9a1b-2c3d4e5f6a7b",
  "schema_v": 1,
  "ops": [
    {
      "op_id": "018f3a5b-8000-7000-8000-000000000001",
      "type": "sale.create",
      "client_ts": "2026-10-28T10:15:30+03:00",
      "payload": { ... }
    }
  ]
}
```
- **Batch Constraints:** Max operations per batch: `50` (defined in `src/domain/constants.ts`). Max body size: `2 MB`. Exceeding either returns HTTP 413.

### 3.2 Push Response
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "results": [
    {
      "op_id": "018f3a5b-8000-7000-8000-000000000001",
      "status": "applied",
      "ref": {
        "takes": [
          { "line_id": "018f...", "batch_id": "018f...", "quantity_base_units": 2 }
        ]
      }
    },
    {
      "op_id": "018f3a5b-8000-7000-8000-000000000002",
      "status": "duplicate"
    },
    {
      "op_id": "018f3a5b-8000-7000-8000-000000000003",
      "status": "rejected",
      "reason": "validation",
      "error": {
        "code": "VALIDATION_FAILED",
        "message": "البيانات غير صحيحة",
        "details": [{ "path": ["payload", "total_piasters"], "message": "المبلغ لازم يكون أكبر من صفر" }]
      }
    }
  ],
  "server_time": "2026-10-28T07:15:31Z"
}
```
- `applied`: Mutation executed. `ref` contains authoritative server results (e.g. real batch allocations).
- `duplicate`: `op_id` was previously applied or recorded. Treated by the client as a success.
- `rejected`: The operation was rejected by business rules or schema validation. It is **never resent automatically**; it moves to the client's "محتاج مراجعة" (Needs review) screen.

### 3.3 Server Execution Algorithm (Per Operation)
For each operation in `request.ops` executed inside `withTenant(storeId)`:
```text
1. Check sync_ops for op_id:
   if exists:
     return { op_id, status: 'duplicate' }

2. Validate payload against zod schema for (type, schema_v):
   if invalid:
     INSERT sync_ops (op_id, store_id, device_id, type, schema_v, status='rejected', reason='validation', error)
     return { op_id, status: 'rejected', reason: 'validation', error }

3. Check store subscription status:
   if expired and op is a mutation:
     INSERT sync_ops (..., status='rejected', reason='subscription_expired')
     return { op_id, status: 'rejected', reason: 'subscription_expired' }

4. Begin Nested Savepoint / Transaction:
   result = handlers[type](op.payload, txContext)
   if handler returns domain failure:
     INSERT sync_ops (..., status='rejected', reason=result.reason, error=result.error)
     return { op_id, status: 'rejected', reason: result.reason, error: result.error }

5. Record State & Change Log:
   INSERT sync_ops (op_id, store_id, device_id, type, schema_v, status='applied', result=result.ref)
   For every mutated entity:
     INSERT change_log (store_id, entity, entity_id, op, ts)
   return { op_id, status: 'applied', ref: result.ref }
```

---

## 4. Operation Types (Ops) and Payloads

All money values are integer piasters (`*_piasters`). All quantities are integer base units (`*_base_units`: pieces, or grams for weighed goods). All IDs are client-generated UUID v7s.

### 4.1 Products and Variants (Compound Operation)

In accordance with [ADR-0009](docs/adr/0009-product-variants.md), sellable variants hold barcodes, unit packaging, and selling prices. Product creation and updates are submitted as an atomic compound operation to prevent orphaned records:

| Operation | Payload Schema | Server Action & Effects |
|---|---|---|
| `product.upsert` | `{ store_product_id: uuid, global_product_id?: uuid\|null, name_ar: string, category: string, unit: string, custom?: boolean, variants: [{ store_variant_id: uuid, global_variant_id?: uuid\|null, flavor?: string\|null, size_value?: number\|null, size_unit?: string\|null, pack_qty: int, barcode?: string\|null, sell_price_piasters: bigint, is_active: boolean }] }` | 1. Upserts `store_products` record with shop ownership validation.<br>2. Upserts all child `store_variants` atomically.<br>3. If `custom=true` and `share_custom_products=true`, enqueues candidate in `catalog_candidates`.<br>4. Appends to `change_log` for product and each variant. |
| `product.archive` | `{ store_product_id: uuid }` | Soft-deactivates product: sets `is_active = false` on `store_products` and all associated `store_variants`. Retains historical sales and batch relationships. |
| `suggestion.accept` | `{ suggestion_id: uuid, store_product_id: uuid, store_variant_id: uuid, sell_price_piasters: bigint }` | Creates store product and variant linked to the catalog suggestion. Sets shop's initial price. Updates suggestion status to accepted. |
| `suggestion.dismiss` | `{ suggestion_id: uuid }` | Dismisses suggestion for this store. |
| `suggestion.report` | `{ suggestion_id: uuid, reason: string }` | Records catalog report and increments flag counter. |

### 4.2 Purchases & Inventory Intake

Supplier goods arrivals are handled as structured purchases. Stock corrections use manual adjustments:

| Operation | Payload Schema | Server Action & Effects |
|---|---|---|
| `purchase.create` | `{ purchase_id: uuid, supplier_contact_id?: uuid\|null, total_piasters: bigint, paid: boolean, received_at: string, lines: [{ line_id: uuid, store_product_id: uuid, store_variant_id: uuid, quantity_base_units: int, unit_cost_piasters: bigint, expires_on?: string\|null }] }` | 1. Creates `purchases` record with `op_id`.<br>2. Inserts `purchase_lines`.<br>3. Instantiates incoming stock batches with remaining quantities and cost.<br>4. Records `purchase` movements in inventory ledger.<br>5. **Credit purchase rule:** If `paid=false` and `supplier_contact_id` is supplied, atomically creates a `debt_entries` record (`direction: 'i_owe'`, `amount_piasters: total_piasters`, `note_ar: 'فاتورة توريد بضاعة'`). |
| `stock.adjust` | `{ adjust_id: uuid, store_variant_id: uuid, batch_id?: uuid\|null, quantity_delta_base_units: int, reason: 'breakage'\|'expired'\|'inventory_count'\|'theft'\|'found', note?: string }` | 1. Updates batch `remaining_base` (if batch specified) or adjusts inventory pool.<br>2. Records `adjust` movement in stock ledger.<br>3. Emits alert if remaining stock drops below low-stock threshold. |
| `stock.waste` | `{ waste_id: uuid, store_variant_id: uuid, batch_id?: uuid\|null, quantity_base_units: int, reason: 'expired'\|'damaged'\|'other' }` | Records waste entry and depletes batch inventory. |

### 4.3 Sales

| Operation | Payload Schema | Server Action & Effects |
|---|---|---|
| `sale.create` | `{ sale_id: uuid, customer_contact_id?: uuid\|null, payment_method: 'cash'\|'wallet'\|'card'\|'debt', total_piasters: bigint, lines: [{ line_id: uuid, store_product_id: uuid, store_variant_id: uuid, quantity_base_units: int, unit_price_piasters: bigint, total_piasters: bigint }] }` | 1. Inserts `sales` record with `op_id`.<br>2. Inserts `sale_lines`.<br>3. **Authoritative FEFO:** Depletes batches in First-Expired-First-Out order; records exact allocations (`takes`). If stock is insufficient, marks `negative=true`.<br>4. Records `sale` movements.<br>5. If `payment_method='debt'`, atomically creates a `debt_entries` record (`direction: 'owed_to_me'`).<br>6. Returns final allocations in `ref.takes`. |
| `sale.void` | `{ sale_id: uuid, reason: string }` | 1. Idempotency check: if `sales.voided_at` is already set, returns `applied` with `{ already_voided: true }`.<br>2. Reads recorded `takes` from `sale_lines`.<br>3. Restores exact depleted quantities back to original batches.<br>4. Records reversing `void` stock movements.<br>5. Marks `voided_at = now()`.<br>6. If original sale was on credit, generates an offsetting `debt_entries` settlement (`settles_entry_id: debt_id`). |

### 4.4 Contacts & Append-Only Debt Ledger

Customers and suppliers are unified under `contacts`. No mutable balance columns exist on contacts; all balances are derived from immutable `debt_entries`:

| Operation | Payload Schema | Server Action & Effects |
|---|---|---|
| `contact.upsert` | `{ contact_id: uuid, kind: 'customer'\|'supplier'\|'both', name_ar: string, phone?: string\|null }` | Upserts contact demographic record strictly within the store. Contains zero balance state. |
| `debt_entry.create` | `{ entry_id: uuid, contact_id: uuid, direction: 'owed_to_me'\|'i_owe', amount_piasters: bigint, note_ar?: string\|null, settles_entry_id?: uuid\|null }` | 1. Validates that `contact_id` belongs to current store.<br>2. Appends immutable debt transaction.<br>3. If `settles_entry_id` is provided, links the settlement to the parent entry.<br>4. Contact balance is computed dynamically on demand: $\sum(\text{owed\_to\_me}) - \sum(\text{i\_owe})$. |

### 4.5 Expenses & Wallets (Immutable Audit Trail)

Deleting an expense directly is strictly prohibited because it breaks the cash register audit trail and violates RLS permissions on `wallet_transactions`. Corrections must use an offsetting reversal:

| Operation | Payload Schema | Server Action & Effects |
|---|---|---|
| `expense.create` | `{ expense_id: uuid, wallet_id: uuid, category: 'electricity'\|'rent'\|'salaries'\|'transport'\|'maintenance'\|'other', amount_piasters: bigint, note_ar?: string\|null, spent_at: string }` | Inserts a withdrawal transaction into `wallet_transactions` (`kind: 'withdrawal'`), records the running balance `balance_after_piasters`, and links to the store wallet. |
| `expense.void` | `{ original_expense_op_id: uuid, wallet_id: uuid, reason: string }` | 1. Verifies that `original_expense_op_id` exists in `sync_ops` and belongs to this store.<br>2. Verifies that it has not already been reversed (guards against duplicate reversals).<br>3. Inserts an offsetting reversing entry into `wallet_transactions` (`kind: 'reversal'`) with `amount_piasters: original.amount_piasters`.<br>4. Restores wallet running balance. |

### 4.6 Store Profile & Alerts

| Operation | Payload Schema | Server Action & Effects |
|---|---|---|
| `store.update` | `{ name?: string, shop_type?: string, governorate?: string, area?: string\|null, share_custom_products?: boolean, receive_suggestions?: boolean, settings?: object }` | Updates store profile metadata. |
| `alert.dismiss` | `{ kind: string, ref_id: uuid }` | Inserts record into `alert_dismissals` to mute notification. |

### 4.7 Phase Boundary: Financial Services, Scratch Cards & Bills
In accordance with [ADR-0010](docs/adr/0010-services-prepaid-cards-bills-and-transfers-with-commissions.md) and [docs/04-tasks.md](docs/04-tasks.md) (`P3-B-12`, `P3-F-14`, `P3-Q-04`), sync operations for serialized scratch cards (`card_serials` with encrypted PINs), utility bill payments (`store_bill_payments`), and financial wallet cash-in/cash-out (`service_items`, `commission_rules`) are **deferred to Phase 3**. They are not included in `schema_v: 1` in Phase 2.2.

---

## 5. Pull Protocol and Client-Facing Entity Models

### 5.1 Pull Request
```http
GET /api/sync/pull?cursor=1042&limit=500
Cookie: <session>
X-Hesba-Client: web/<app_version>
X-Hesba-Schema: 1
```

### 5.2 Pull Response
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "changes": [
    {
      "seq": 1043,
      "entity": "store_products",
      "id": "018f3a5b-7c8d-7e0f-9a1b-2c3d4e5f6a7b",
      "op": "upsert",
      "data": {
        "id": "018f3a5b-7c8d-7e0f-9a1b-2c3d4e5f6a7b",
        "global_product_id": null,
        "name_ar": "زبادي بلدي",
        "category": "dairy",
        "unit": "piece",
        "is_active": true
      }
    },
    {
      "seq": 1044,
      "entity": "store_variants",
      "id": "018f3a5b-7c8d-7e0f-9a1b-2c3d4e5f6a7c",
      "op": "upsert",
      "data": {
        "id": "018f3a5b-7c8d-7e0f-9a1b-2c3d4e5f6a7c",
        "store_product_id": "018f3a5b-7c8d-7e0f-9a1b-2c3d4e5f6a7b",
        "global_variant_id": null,
        "flavor": "سادة",
        "size_value": 105,
        "size_unit": "g",
        "pack_qty": 1,
        "barcode": "6221234567890",
        "sell_price_piasters": 850,
        "is_active": true
      }
    }
  ],
  "next_cursor": 1044,
  "has_more": false
}
```
*(If no new entries exist beyond `cursor`, the endpoint returns `HTTP 204 No Content`).*

### 5.3 Client-Facing Entity Names Compatible with Dexie
The pull payload maps server tables into stable client-facing entity collections stored directly in IndexedDB:

1. `store_products`: `{ id, global_product_id, name_ar, category, unit, is_active }`
2. `store_variants`: `{ id, store_product_id, global_variant_id, flavor, size_value, size_unit, pack_qty, barcode, sell_price_piasters, is_active }`
3. `store_stock_batches`: `{ id, store_variant_id, remaining_base_units, cost_piasters, expires_on }`
4. `sales`: `{ id, customer_contact_id, payment_method, total_piasters, voided_at, lines: [...] }`
5. `contacts`: `{ id, kind, name_ar, phone }`
6. `debt_entries`: `{ id, contact_id, direction, amount_piasters, note_ar, settles_entry_id, created_at }`
7. `wallets`: `{ id, provider, label_ar, is_active }`
8. `wallet_transactions`: `{ id, wallet_id, kind, amount_piasters, fee_piasters, balance_after_piasters, created_at }`
9. `alerts`: `{ id, kind, severity, message_ar, read_at, created_at }`

### 5.4 The Rebase Rule
When the mobile client downloads delta changes from `/api/sync/pull`, it must merge server changes while preserving optimistic, unsynced Outbox operations:
```text
function applyPullAndRebase(changes, nextCursor):
  1. Open Dexie transaction across local tables.
  2. For each change in changes:
       if change.op == 'upsert':
         localTable(change.entity).put(change.data)
       else if change.op == 'delete':
         localTable(change.entity).delete(change.id)
  3. Update sync_meta.last_seq = nextCursor.
  4. Query all Outbox operations in state 'pending' or 'sending', ordered by client local seq ASC.
  5. For each pendingOp in outboxOps:
       domain.applyOptimistic(pendingOp.type, pendingOp.payload)
  6. Refresh screen views and emit sync completion event.
```

---

## 6. Rejection Reasons and User Visibility

Every rejected operation is assigned a canonical reason and must appear in the "محتاج مراجعة" (Needs review) screen with clear Arabic explanations:

| Reason | Technical Meaning | User Explanation (ar.json) | Action |
|---|---|---|---|
| `validation` | Payload violates zod schema | "العملية دي فيها مشكلة في البيانات" | User can view field errors, edit payload, and retry |
| `duplicate_op_id` | Operation was already applied | Treated as success | Automatically removed from Outbox |
| `forbidden` | Tenant mismatch / unauthorized action | "غير مصرح لك بإجراء العملية دي" | Logged; operation quarantined |
| `subscription_expired` | Account is in read-only trial mode | "الاشتراك خلص، متاح العرض فقط" | Prompts renewal; keeps queue saved |
| `not_found` | Target entity does not exist on server | "العنصر المطلوب غير موجود" | Shown in review screen |
| `fefo_depleted` | Selected batch has no remaining stock | "الكمية مش متوفرة في المخزن" | Server flags negative stock or prompts stock intake |
| `already_reversed` | Void operation attempted on already voided record | "العملية ملغية بالفعل" | Marked applied with no second effect |
| `limit_exceeded` | Exceeded rate or custom product threshold | "وصلت للحد الأقصى اليومي" | Retry next day |

---

## 7. Client Outbox Lifecycle & Trigger Events

### 7.1 Operation States
```text
[pending] ──(network send)──> [sending] ──(server 200 applied)──> [applied] (deleted from outbox)
    │                             │
    │                             ├──(duplicate)─────────────────> [applied] (deleted from outbox)
    │                             │
    │                             ├──(business rejected)─────────> [rejected] (shown in "محتاج مراجعة")
    │                             │
    │                             └──(network error / 5xx)───────> [pending] (retry with backoff)
    │
    └──(exceeded max retries)───> [quarantined] (retains rest of queue from blocking)
```

### 7.2 Event-Driven Sync Triggers
Sync runs **only** upon specific application lifecycle events:
1. **Debounced Local Mutation:** 3 seconds after the last user write in Dexie.
2. **Application Startup:** When the PWA is launched or initialized.
3. **Network Reconnection:** `window.addEventListener('online', ...)`.
4. **App Visibility:** Tab returns to foreground (`document.visibilityState === 'visible'`).
5. **Manual Trigger:** User taps the "زامن دلوقتي" (Sync now) button.

*Prohibition:* `setInterval` is **strictly forbidden**. On failures, the client uses **exponential backoff with randomized full jitter** (`min(30s, base * 2^attempt + rand(0, 1000ms))`).

---

## 8. Schema Evolution & Versioning (`schema_v`)

1. **Active and Previous Compatibility:** The server supports the active version ($N$) and the previous version ($N-1$).
2. **Incompatible Schema Rejection:** If `client_schema_v < min_supported_v` or `client_schema_v > current_v`, the server immediately rejects the request with **HTTP 409 Conflict**:
   ```json
   {
     "error": {
       "code": "SCHEMA_VERSION_UNSUPPORTED",
       "message": "نسخة التطبيق قديمة وبحاجة للتحديث لتفادي فقدان البيانات",
       "details": {
         "client_schema_v": 1,
         "min_supported_v": 2,
         "current_v": 3
       }
     }
   }
   ```
3. **Queue Preservation on 409:** The client halts automatic background sync attempts to prevent server log flood, preserves all Outbox items in Dexie, and displays a prominent "حدّث التطبيق" screen. As soon as the service worker or user refreshes to the new PWA release, sync resumes seamlessly without data loss.

---

## 9. Mandatory Sync Protocol Verification Tests

1. **Idempotency Invariant:** Submitting the exact same push batch twice returns `applied` on the first call and `duplicate` on the second call, with zero duplicated side-effects in PostgreSQL.
2. **Network Interruption in Flight:** Simulating a network drop after server commit but before client response leaves operations in `pending`; resending the batch cleanly completes with `duplicate`.
3. **Concurrent Multi-Device Sales:** Two devices selling the same variant concurrently deplete batches authoritatively via FEFO, correctly flag negative inventory if depleted, and resolve balances identically after pull.
4. **Rebase Consistency:** A pending local sale combined with a pull containing server batch updates merges without overwriting local unpushed items.
5. **Reversing Expense Audit:** An `expense.create` followed by `expense.void` generates an offsetting `reversal` entry; duplicate void attempts are rejected with `already_reversed`.
6. **Cross-Tenant Isolation Invariant:** Submitting an operation payload referencing another store's `store_product_id`, `wallet_id`, or `contact_id` is rejected with `forbidden`, and pull delta queries never return cross-tenant change records.
7. **HTTP 409 Queue Safety:** Sending an outdated `schema_v` receives HTTP 409 without clearing or mutating the local Outbox queue.

---

## 10. Complete Operation Examples

### Compound Product Creation (`product.upsert`)
```json
{
  "op_id": "018f3a5b-8000-7000-8000-000000000010",
  "type": "product.upsert",
  "client_ts": "2026-10-28T10:00:00+03:00",
  "payload": {
    "store_product_id": "018f3a5b-8000-7000-8000-000000000011",
    "global_product_id": null,
    "name_ar": "شيبسي عائلي",
    "category": "snacks",
    "unit": "piece",
    "custom": true,
    "variants": [
      {
        "store_variant_id": "018f3a5b-8000-7000-8000-000000000012",
        "flavor": "جبنة متبلة",
        "size_value": 85,
        "size_unit": "g",
        "pack_qty": 1,
        "barcode": "6221111222333",
        "sell_price_piasters": 1500,
        "is_active": true
      }
    ]
  }
}
```

### Stock Intake on Credit (`purchase.create`)
```json
{
  "op_id": "018f3a5b-8000-7000-8000-000000000020",
  "type": "purchase.create",
  "client_ts": "2026-10-28T10:05:00+03:00",
  "payload": {
    "purchase_id": "018f3a5b-8000-7000-8000-000000000021",
    "supplier_contact_id": "018f3a5b-8000-7000-8000-000000000022",
    "total_piasters": 120000,
    "paid": false,
    "received_at": "2026-10-28T10:05:00+03:00",
    "lines": [
      {
        "line_id": "018f3a5b-8000-7000-8000-000000000023",
        "store_product_id": "018f3a5b-8000-7000-8000-000000000011",
        "store_variant_id": "018f3a5b-8000-7000-8000-000000000012",
        "quantity_base_units": 100,
        "unit_cost_piasters": 1200,
        "expires_on": "2027-04-30"
      }
    ]
  }
}
```

### Sale Depletion (`sale.create`)
```json
{
  "op_id": "018f3a5b-8000-7000-8000-000000000030",
  "type": "sale.create",
  "client_ts": "2026-10-28T10:10:00+03:00",
  "payload": {
    "sale_id": "018f3a5b-8000-7000-8000-000000000031",
    "customer_contact_id": null,
    "payment_method": "cash",
    "total_piasters": 3000,
    "lines": [
      {
        "line_id": "018f3a5b-8000-7000-8000-000000000032",
        "store_product_id": "018f3a5b-8000-7000-8000-000000000011",
        "store_variant_id": "018f3a5b-8000-7000-8000-000000000012",
        "quantity_base_units": 2,
        "unit_price_piasters": 1500,
        "total_piasters": 3000
      }
    ]
  }
}
```

### Auditable Expense Void (`expense.void`)
```json
{
  "op_id": "018f3a5b-8000-7000-8000-000000000040",
  "type": "expense.void",
  "client_ts": "2026-10-28T10:15:00+03:00",
  "payload": {
    "original_expense_op_id": "018f3a5b-8000-7000-8000-000000000005",
    "wallet_id": "018f3a5b-8000-7000-8000-000000000006",
    "reason": "تسجيل مكرر لمصروف فاتورة النظافة"
  }
}
```

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
