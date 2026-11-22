-- Migration: 20261122000000_physical_stocktaking
-- Physical inventory stocktaking sessions, immutable snapshots, item-level counting, and discrepancy reconciliation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stocktake_session_status') THEN
    CREATE TYPE "stocktake_session_status" AS ENUM ('in_progress', 'reconciled', 'cancelled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stocktake_scope') THEN
    CREATE TYPE "stocktake_scope" AS ENUM ('full', 'category', 'selected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stocktake_discrepancy_kind') THEN
    CREATE TYPE "stocktake_discrepancy_kind" AS ENUM ('unrecorded_sales', 'damaged_or_expired', 'unknown_adjustment');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "stocktake_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "status" "stocktake_session_status" NOT NULL DEFAULT 'in_progress',
  "scope" "stocktake_scope" NOT NULL DEFAULT 'full',
  "category" TEXT,
  "notes" TEXT,
  "op_id" UUID,
  "total_products" INTEGER NOT NULL DEFAULT 0,
  "counted_products" INTEGER NOT NULL DEFAULT 0,
  "shortage_count" INTEGER NOT NULL DEFAULT 0,
  "surplus_count" INTEGER NOT NULL DEFAULT 0,
  "matched_count" INTEGER NOT NULL DEFAULT 0,
  "net_cost_piasters" BIGINT NOT NULL DEFAULT 0,
  "cost_confirmed" BOOLEAN NOT NULL DEFAULT true,
  "reconciled_at" TIMESTAMPTZ(6),
  "reconciled_by" UUID,
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stocktake_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_sessions_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stocktake_sessions_reconciled_by_fkey" FOREIGN KEY ("reconciled_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_stocktake_sessions_store_op"
  ON "stocktake_sessions" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_stocktake_sessions_store_created"
  ON "stocktake_sessions" ("store_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "stocktake_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "store_variant_id" UUID NOT NULL,
  "store_product_id" UUID NOT NULL,
  "snapshot_quantity_base" BIGINT NOT NULL,
  "snapshot_cost_piasters" BIGINT,
  "counted_quantity_base" BIGINT,
  "counted_at" TIMESTAMPTZ(6),
  "expected_quantity_base" BIGINT,
  "discrepancy_quantity_base" BIGINT,
  "discrepancy_cost_piasters" BIGINT,
  "cost_confirmed" BOOLEAN NOT NULL DEFAULT true,
  "classification" "stocktake_discrepancy_kind",
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stocktake_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stocktake_items_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stocktake_items_session_id_fkey" FOREIGN KEY ("session_id")
    REFERENCES "stocktake_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stocktake_items_store_variant_id_fkey" FOREIGN KEY ("store_variant_id")
    REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stocktake_items_store_product_id_fkey" FOREIGN KEY ("store_product_id")
    REFERENCES "store_products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_stocktake_items_session_variant"
  ON "stocktake_items" ("session_id", "store_variant_id");
CREATE INDEX IF NOT EXISTS "idx_stocktake_items_store_session"
  ON "stocktake_items" ("store_id", "session_id");

-- Tenant isolation (FORCE RLS)
ALTER TABLE "stocktake_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stocktake_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "stocktake_sessions";
CREATE POLICY "tenant_isolation" ON "stocktake_sessions"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

ALTER TABLE "stocktake_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stocktake_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "stocktake_items";
CREATE POLICY "tenant_isolation" ON "stocktake_items"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "stocktake_sessions" TO hesba_app;
    REVOKE DELETE ON "stocktake_sessions" FROM hesba_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "stocktake_items" TO hesba_app;
  END IF;
END $$;
