-- QA-30 + QA-31 (ADR-0027): supplier purchases, credit sales, discounts and returns.
--
-- Built on the existing tables: `purchases` / `purchase_lines` (until now never written),
-- the people ledger `debt_entries` (ADR-0023), and `sales` / `sale_lines`. Append-only tables
-- stay append-only for the application role: a cancelled purchase is a NEW `purchase_voids`
-- row and a return a NEW `sale_returns` row, like `sale_voids` (ADR-0022).
--
-- No existing row is changed: every new column is nullable or defaults to 0.

-- 1. Same-store references (a row can only point at a purchase / sale of its own store).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchases_store_id_id" ON "purchases" ("store_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sale_lines_store_id_id" ON "sale_lines" ("store_id", "id");

-- 2. Purchases: the supplier invoice. Its total is the sum of the lines' totals (server-side).
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "created_by" UUID;
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "chk_purchases_total_bounds";
ALTER TABLE "purchases" ADD CONSTRAINT "chk_purchases_total_bounds"
  CHECK ("total_piasters" >= 0 AND "total_piasters" <= 1000000000) NOT VALID;

-- What the whole line cost (the authority, ADR-0021) and the stock batch it created.
ALTER TABLE "purchase_lines" ADD COLUMN IF NOT EXISTS "total_cost_piasters" BIGINT;
ALTER TABLE "purchase_lines" ADD COLUMN IF NOT EXISTS "batch_id" UUID;
ALTER TABLE "purchase_lines" DROP CONSTRAINT IF EXISTS "purchase_lines_batch_id_fkey";
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "store_stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" DROP CONSTRAINT IF EXISTS "chk_purchase_lines_bounds";
ALTER TABLE "purchase_lines" ADD CONSTRAINT "chk_purchase_lines_bounds"
  CHECK (
    "quantity_base_units" > 0 AND "quantity_base_units" <= 1000000
    AND ("total_cost_piasters" IS NULL OR ("total_cost_piasters" >= 0 AND "total_cost_piasters" <= 1000000000))
  ) NOT VALID;

-- A cancelled purchase: one immutable row per purchase, its own client op_id.
CREATE TABLE IF NOT EXISTS "purchase_voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "op_id" UUID NOT NULL,
    "reason" TEXT,
    "voided_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_voids_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_voids_purchase_fkey" FOREIGN KEY ("store_id", "purchase_id") REFERENCES "purchases"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_voids_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchase_voids_purchase" ON "purchase_voids" ("store_id", "purchase_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_purchase_voids_store_op" ON "purchase_voids" ("store_id", "op_id");

-- 3. Ledger links: an invoice's debt, its payments and its reversal point at the invoice.
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "purchase_id" UUID;
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "sale_id" UUID;
ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "debt_entries_purchase_fkey";
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_purchase_fkey"
  FOREIGN KEY ("store_id", "purchase_id") REFERENCES "purchases"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "debt_entries_sale_fkey";
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_sale_fkey"
  FOREIGN KEY ("store_id", "sale_id") REFERENCES "sales"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_debt_entries_store_purchase" ON "debt_entries" ("store_id", "purchase_id");
CREATE INDEX IF NOT EXISTS "idx_debt_entries_store_sale" ON "debt_entries" ("store_id", "sale_id");

-- 4. Discounts: the invoice discount, and each line's share of it (line total is after it).
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "discount_piasters" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "discount_piasters" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "chk_sales_discount_bounds";
ALTER TABLE "sales" ADD CONSTRAINT "chk_sales_discount_bounds"
  CHECK ("discount_piasters" >= 0 AND "discount_piasters" <= 1000000000) NOT VALID;
ALTER TABLE "sale_lines" DROP CONSTRAINT IF EXISTS "chk_sale_lines_discount_bounds";
ALTER TABLE "sale_lines" ADD CONSTRAINT "chk_sale_lines_discount_bounds"
  CHECK ("discount_piasters" >= 0 AND "discount_piasters" <= 1000000000) NOT VALID;

-- 5. Returns: a return references the original sale; each line references the sold line.
CREATE TABLE IF NOT EXISTS "sale_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "op_id" UUID NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    -- How the returned value went back: taken off the invoice's open debt, or paid back.
    "credited_piasters" BIGINT NOT NULL DEFAULT 0,
    "refunded_piasters" BIGINT NOT NULL DEFAULT 0,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_returns_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_returns_sale_fkey" FOREIGN KEY ("store_id", "sale_id") REFERENCES "sales"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "chk_sale_returns_amounts" CHECK (
      "amount_piasters" > 0 AND "amount_piasters" <= 1000000000
      AND "credited_piasters" >= 0 AND "refunded_piasters" >= 0
      AND "credited_piasters" + "refunded_piasters" = "amount_piasters"
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sale_returns_store_id_id" ON "sale_returns" ("store_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sale_returns_store_op" ON "sale_returns" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_sale_returns_store_sale" ON "sale_returns" ("store_id", "sale_id");

CREATE TABLE IF NOT EXISTS "sale_return_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "quantity_base" INTEGER NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_return_lines_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_return_lines_return_fkey" FOREIGN KEY ("store_id", "return_id") REFERENCES "sale_returns"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_return_lines_sale_line_fkey" FOREIGN KEY ("store_id", "sale_line_id") REFERENCES "sale_lines"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chk_sale_return_lines_bounds" CHECK (
      "quantity_base" > 0 AND "quantity_base" <= 1000000
      AND "amount_piasters" >= 0 AND "amount_piasters" <= 1000000000
    )
);
CREATE INDEX IF NOT EXISTS "idx_sale_return_lines_store_line" ON "sale_return_lines" ("store_id", "sale_line_id");

-- 6. Tenant isolation (FORCE RLS) on the new tables, and append-only grants.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_voids', 'sale_returns', 'sale_return_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I
         USING (store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)
         WITH CHECK (store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)',
      t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
      EXECUTE format('GRANT SELECT, INSERT ON %I TO hesba_app', t);
      EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM hesba_app', t);
    END IF;
  END LOOP;
END $$;
