-- Migration: 20261029190000_catalog_foundation_and_remove_barcode
-- Phase 3.1: Catalog Foundation, Egyptian Product Catalog & Community Product Suggestions
-- 1. Remove barcode completely from global_variants and store_variants
-- 2. Enhance brands, global_products, and store_products
-- 3. Add catalog_candidates, candidate_adoptions, catalog_suggestions, catalog_reports, catalog_notifications with RLS

-- Drop barcode from global_variants
DROP INDEX IF EXISTS "idx_global_variants_barcode";
ALTER TABLE "global_variants" DROP COLUMN IF EXISTS "barcode";

-- Drop barcode from store_variants
DROP INDEX IF EXISTS "idx_store_variants_store_barcode";
ALTER TABLE "store_variants" DROP COLUMN IF EXISTS "barcode";

-- Enhance brands
CREATE INDEX IF NOT EXISTS "idx_brands_name_ar" ON "brands" ("name_ar");

-- Enhance global_products
ALTER TABLE "global_products" ADD COLUMN IF NOT EXISTS "name_en" TEXT;
ALTER TABLE "global_products" ADD COLUMN IF NOT EXISTS "name_norm" TEXT;
ALTER TABLE "global_products" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "global_products" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "global_products" SET "name_norm" = "name_ar" WHERE "name_norm" IS NULL;
ALTER TABLE "global_products" ALTER COLUMN "name_norm" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_global_products_name_trgm" ON "global_products" USING gin ("name_norm" gin_trgm_ops);

-- Enhance store_products
ALTER TABLE "store_products" ADD COLUMN IF NOT EXISTS "name_norm" TEXT;
ALTER TABLE "store_products" ADD COLUMN IF NOT EXISTS "is_custom" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_store_products_store_name_norm" ON "store_products" ("store_id", "name_norm");

-- Create catalog_candidates table (server-managed catalog candidate queue)
CREATE TABLE IF NOT EXISTS "catalog_candidates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submitted_by_store_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "brand_name" TEXT,
    "category" TEXT NOT NULL,
    "flavor" TEXT,
    "size_value" DECIMAL,
    "size_unit" TEXT,
    "pack_qty" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "accepts_count" INTEGER NOT NULL DEFAULT 0,
    "reports_count" INTEGER NOT NULL DEFAULT 0,
    "merged_into_id" UUID,
    "first_submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "promoted_at" TIMESTAMPTZ(6),

    CONSTRAINT "catalog_candidates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_candidates_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "global_products"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_catalog_candidates_name_trgm" ON "catalog_candidates" USING gin ("name_norm" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "idx_catalog_candidates_status" ON "catalog_candidates" ("status");

-- Create candidate_adoptions table (enforces unique shop vote/adoption invariant)
CREATE TABLE IF NOT EXISTS "candidate_adoptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "candidate_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_adoptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "candidate_adoptions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "catalog_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "candidate_adoptions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "idx_candidate_adoptions_unique_store" UNIQUE ("candidate_id", "store_id")
);

CREATE INDEX IF NOT EXISTS "idx_candidate_adoptions_store_id" ON "candidate_adoptions" ("store_id");

-- Create catalog_suggestions table (tenant-isolated notifications for shop adoption)
CREATE TABLE IF NOT EXISTS "catalog_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acted_at" TIMESTAMPTZ(6),

    CONSTRAINT "catalog_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_suggestions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "catalog_suggestions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "catalog_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "idx_catalog_suggestions_store_candidate" UNIQUE ("store_id", "candidate_id")
);

CREATE INDEX IF NOT EXISTS "idx_catalog_suggestions_store_status" ON "catalog_suggestions" ("store_id", "status");

-- Create catalog_reports table
CREATE TABLE IF NOT EXISTS "catalog_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "catalog_reports_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "catalog_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_catalog_reports_candidate" ON "catalog_reports" ("candidate_id");

-- Create catalog_notifications table (idempotent 1 notification per candidate per store)
CREATE TABLE IF NOT EXISTS "catalog_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_notifications_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "catalog_notifications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "catalog_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "idx_catalog_notifications_store_candidate" UNIQUE ("store_id", "candidate_id")
);

CREATE INDEX IF NOT EXISTS "idx_catalog_notifications_store_unread" ON "catalog_notifications" ("store_id", "is_read");

-- Row Level Security (RLS) Configuration

-- catalog_candidates: server only (no store access directly)
ALTER TABLE "catalog_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_candidates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "catalog_candidates_migrator_all" ON "catalog_candidates";
CREATE POLICY "catalog_candidates_migrator_all" ON "catalog_candidates"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- candidate_adoptions: isolated by store
ALTER TABLE "candidate_adoptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_adoptions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "candidate_adoptions";
CREATE POLICY "tenant_isolation" ON "candidate_adoptions"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "candidate_adoptions_migrator_all" ON "candidate_adoptions";
CREATE POLICY "candidate_adoptions_migrator_all" ON "candidate_adoptions"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- catalog_suggestions: isolated by store
ALTER TABLE "catalog_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_suggestions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "catalog_suggestions";
CREATE POLICY "tenant_isolation" ON "catalog_suggestions"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "catalog_suggestions_migrator_all" ON "catalog_suggestions";
CREATE POLICY "catalog_suggestions_migrator_all" ON "catalog_suggestions"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- catalog_reports: isolated by store
ALTER TABLE "catalog_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_reports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "catalog_reports";
CREATE POLICY "tenant_isolation" ON "catalog_reports"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "catalog_reports_migrator_all" ON "catalog_reports";
CREATE POLICY "catalog_reports_migrator_all" ON "catalog_reports"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- catalog_notifications: isolated by store
ALTER TABLE "catalog_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "catalog_notifications";
CREATE POLICY "tenant_isolation" ON "catalog_notifications"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DROP POLICY IF EXISTS "catalog_notifications_migrator_all" ON "catalog_notifications";
CREATE POLICY "catalog_notifications_migrator_all" ON "catalog_notifications"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- Grant privileges to hesba_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_candidates" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "candidate_adoptions" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_suggestions" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_reports" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_notifications" TO hesba_app;
