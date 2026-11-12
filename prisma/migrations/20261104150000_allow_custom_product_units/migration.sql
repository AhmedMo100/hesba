-- Drop legacy restriction on store_products.unit to allow Egyptian supermarket selling methods (علبة, برطمان, كيس, كرتونة, etc.) and custom units
ALTER TABLE "store_products" DROP CONSTRAINT IF EXISTS "chk_store_products_unit";
