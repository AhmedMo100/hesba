-- AlterTable
ALTER TABLE "store_products" ADD COLUMN IF NOT EXISTS "buy_price_piasters" BIGINT DEFAULT 0;

-- AlterTable
ALTER TABLE "store_variants" ADD COLUMN IF NOT EXISTS "buy_price_piasters" BIGINT DEFAULT 0;

-- AlterTable
ALTER TABLE "catalog_candidates" ADD COLUMN IF NOT EXISTS "eligible_stores_snapshot" INTEGER DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_store_products_store_global" ON "store_products"("store_id", "global_product_id") WHERE "global_product_id" IS NOT NULL;

-- Enable hesba_migrator access to stores for cross-tenant background administrative jobs
DROP POLICY IF EXISTS "stores_migrator_all" ON "stores";
CREATE POLICY "stores_migrator_all" ON "stores"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);
