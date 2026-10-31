-- Migration: 20261029240000_people_and_suppliers
-- Adds deleted_at and updated_at to contacts, and creates supplier_products table with RLS

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_contacts_store_kind_deleted" ON "contacts" ("store_id", "kind", "deleted_at");

CREATE TABLE IF NOT EXISTS "supplier_products" (
    "store_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "store_product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("supplier_id", "store_product_id"),
    CONSTRAINT "supplier_products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "supplier_products_store_product_id_fkey" FOREIGN KEY ("store_product_id") REFERENCES "store_products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_supplier_products_store_supplier" ON "supplier_products" ("store_id", "supplier_id");

-- RLS
ALTER TABLE "supplier_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_products" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "supplier_products";
CREATE POLICY "tenant_isolation" ON "supplier_products"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "supplier_products_migrator_all" ON "supplier_products";
CREATE POLICY "supplier_products_migrator_all" ON "supplier_products"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- Permissions for hesba_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_products" TO hesba_app;
