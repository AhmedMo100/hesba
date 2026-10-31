-- Migration: 20261030050000_isolate_customers_payables_suppliers
-- Creates separate tables for Customers (ليك), Payables (عليك), and Suppliers (الموردين)
-- Preserves historical contacts and debt entries with safe backfilling

-- 1. Create customers table
CREATE TABLE IF NOT EXISTS "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_customers_store_deleted" ON "customers" ("store_id", "deleted_at");

-- 2. Create payables table
CREATE TABLE IF NOT EXISTS "payables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payables_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_payables_store_deleted" ON "payables" ("store_id", "deleted_at");

-- 3. Create suppliers table
CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "suppliers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_suppliers_store_deleted" ON "suppliers" ("store_id", "deleted_at");

-- 4. Update debt_entries table
ALTER TABLE "debt_entries" ALTER COLUMN "contact_id" DROP NOT NULL;
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "customer_id" UUID;
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "payable_id" UUID;
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "supplier_id" UUID;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debt_entries_customer_id_fkey') THEN
        ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_customer_id_fkey"
            FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debt_entries_payable_id_fkey') THEN
        ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_payable_id_fkey"
            FOREIGN KEY ("payable_id") REFERENCES "payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'debt_entries_supplier_id_fkey') THEN
        ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_supplier_id_fkey"
            FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_debt_entries_store_customer" ON "debt_entries" ("store_id", "customer_id");
CREATE INDEX IF NOT EXISTS "idx_debt_entries_store_payable" ON "debt_entries" ("store_id", "payable_id");
CREATE INDEX IF NOT EXISTS "idx_debt_entries_store_supplier" ON "debt_entries" ("store_id", "supplier_id");

-- 5. Update purchases and sales tables
ALTER TABLE "purchases" ADD COLUMN IF NOT EXISTS "supplier_id" UUID;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchases_supplier_id_fkey') THEN
        ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey"
            FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_purchases_store_supplier" ON "purchases" ("store_id", "supplier_id");

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "customer_id" UUID;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_customer_id_fkey') THEN
        ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey"
            FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_sales_store_customer" ON "sales" ("store_id", "customer_id");

-- 6. Migrate existing data from contacts
-- Migrate customers
INSERT INTO "customers" ("id", "store_id", "name_ar", "phone", "note", "deleted_at", "created_at", "updated_at")
SELECT "id", "store_id", "name_ar", "phone", NULL, "deleted_at", "created_at", "updated_at"
FROM "contacts"
WHERE "section" = 'owedToMe' OR ("section" IS NULL AND "kind" = 'customer')
ON CONFLICT ("id") DO NOTHING;

-- Migrate payables
INSERT INTO "payables" ("id", "store_id", "name_ar", "phone", "note", "deleted_at", "created_at", "updated_at")
SELECT "id", "store_id", "name_ar", "phone", NULL, "deleted_at", "created_at", "updated_at"
FROM "contacts"
WHERE "section" = 'iOwe'
ON CONFLICT ("id") DO NOTHING;

-- Migrate suppliers
INSERT INTO "suppliers" ("id", "store_id", "name_ar", "phone", "note", "deleted_at", "created_at", "updated_at")
SELECT "id", "store_id", "name_ar", "phone", NULL, "deleted_at", "created_at", "updated_at"
FROM "contacts"
WHERE "section" = 'suppliers' OR ("section" IS NULL AND "kind" = 'supplier')
ON CONFLICT ("id") DO NOTHING;

-- Backfill debt_entries
UPDATE "debt_entries"
SET "customer_id" = "contact_id"
WHERE "contact_id" IN (SELECT "id" FROM "customers") AND "customer_id" IS NULL;

UPDATE "debt_entries"
SET "payable_id" = "contact_id"
WHERE "contact_id" IN (SELECT "id" FROM "payables") AND "payable_id" IS NULL;

UPDATE "debt_entries"
SET "supplier_id" = "contact_id"
WHERE "contact_id" IN (SELECT "id" FROM "suppliers") AND "supplier_id" IS NULL;

-- Backfill notes into new tables
UPDATE "customers" c
SET "note" = d."note_ar"
FROM (
  SELECT DISTINCT ON ("customer_id") "customer_id", "note_ar"
  FROM "debt_entries"
  WHERE "note_ar" IS NOT NULL AND "customer_id" IS NOT NULL
  ORDER BY "customer_id", "created_at" DESC
) d
WHERE c."id" = d."customer_id" AND c."note" IS NULL;

UPDATE "payables" p
SET "note" = d."note_ar"
FROM (
  SELECT DISTINCT ON ("payable_id") "payable_id", "note_ar"
  FROM "debt_entries"
  WHERE "note_ar" IS NOT NULL AND "payable_id" IS NOT NULL
  ORDER BY "payable_id", "created_at" DESC
) d
WHERE p."id" = d."payable_id" AND p."note" IS NULL;

UPDATE "suppliers" s
SET "note" = d."note_ar"
FROM (
  SELECT DISTINCT ON ("supplier_id") "supplier_id", "note_ar"
  FROM "debt_entries"
  WHERE "note_ar" IS NOT NULL AND "supplier_id" IS NOT NULL
  ORDER BY "supplier_id", "created_at" DESC
) d
WHERE s."id" = d."supplier_id" AND s."note" IS NULL;

-- 7. Update supplier_products foreign key to point to suppliers
ALTER TABLE "supplier_products" DROP CONSTRAINT IF EXISTS "supplier_products_supplier_id_fkey";
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Enable Row Level Security (RLS)
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "customers";
CREATE POLICY "tenant_isolation" ON "customers"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "customers_migrator_all" ON "customers";
CREATE POLICY "customers_migrator_all" ON "customers"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

ALTER TABLE "payables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payables" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "payables";
CREATE POLICY "tenant_isolation" ON "payables"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "payables_migrator_all" ON "payables";
CREATE POLICY "payables_migrator_all" ON "payables"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "suppliers";
CREATE POLICY "tenant_isolation" ON "suppliers"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "suppliers_migrator_all" ON "suppliers";
CREATE POLICY "suppliers_migrator_all" ON "suppliers"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- 9. Role Grants and Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON "customers" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payables" TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "suppliers" TO hesba_app;
