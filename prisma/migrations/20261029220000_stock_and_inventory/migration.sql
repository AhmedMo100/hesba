-- Migration: 20261029220000_stock_and_inventory
-- Phase 3.5: Inventory and Stock Movements (store_stock_batches, stock_movements, stock_levels, waste_records)

CREATE TABLE IF NOT EXISTS "store_stock_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "store_variant_id" UUID NOT NULL,
    "store_product_id" UUID,
    "batch_code" TEXT,
    "received_quantity_base" BIGINT NOT NULL,
    "remaining_quantity_base" BIGINT NOT NULL,
    "cost_price_minor" BIGINT NOT NULL,
    "cost_total_minor" BIGINT,
    "expiry_date" DATE,
    "supplier_id" UUID,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_stock_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_stock_batches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "store_stock_batches_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_store_stock_batches_fefo" ON "store_stock_batches" ("store_id", "store_variant_id", "expiry_date", "received_at");

CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "store_variant_id" UUID NOT NULL,
    "store_product_id" UUID,
    "batch_id" UUID,
    "type" TEXT NOT NULL,
    "quantity_base" BIGINT NOT NULL,
    "cost_price_minor" BIGINT,
    "balance_after_base" BIGINT,
    "negative" BOOLEAN NOT NULL DEFAULT false,
    "op_id" UUID,
    "sale_line_id" UUID,
    "waste_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "store_stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_stock_movements_store_variant" ON "stock_movements" ("store_id", "store_variant_id", "created_at");

CREATE TABLE IF NOT EXISTS "stock_levels" (
    "store_id" UUID NOT NULL,
    "store_variant_id" UUID NOT NULL,
    "quantity_base" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("store_id", "store_variant_id"),
    CONSTRAINT "stock_levels_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stock_levels_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "waste_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "store_variant_id" UUID NOT NULL,
    "batch_id" UUID,
    "quantity_base" BIGINT NOT NULL,
    "cost_minor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'expired',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "waste_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "waste_records_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RLS
ALTER TABLE "store_stock_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_stock_batches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "store_stock_batches";
CREATE POLICY "tenant_isolation" ON "store_stock_batches"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "store_stock_batches_migrator_all" ON "store_stock_batches";
CREATE POLICY "store_stock_batches_migrator_all" ON "store_stock_batches"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "stock_movements";
CREATE POLICY "tenant_isolation" ON "stock_movements"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "stock_movements_migrator_all" ON "stock_movements";
CREATE POLICY "stock_movements_migrator_all" ON "stock_movements"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "stock_levels";
CREATE POLICY "tenant_isolation" ON "stock_levels"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "stock_levels_migrator_all" ON "stock_levels";
CREATE POLICY "stock_levels_migrator_all" ON "stock_levels"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

ALTER TABLE "waste_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "waste_records" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "waste_records";
CREATE POLICY "tenant_isolation" ON "waste_records"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "waste_records_migrator_all" ON "waste_records";
CREATE POLICY "waste_records_migrator_all" ON "waste_records"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- Permissions for hesba_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_stock_batches" TO hesba_app;
GRANT SELECT, INSERT ON "stock_movements" TO hesba_app; -- append-only!
REVOKE UPDATE, DELETE ON "stock_movements" FROM hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_levels" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "waste_records" TO hesba_app;
