-- Grants and policies for hesba_service, the catalog-promotion cron's role (ADR-0024, QA-34).
-- Run as the table owner (hesba_migrator) AFTER the role exists. If the `public` schema is
-- not owned by the database owner (older databases), the schema owner must also run:
--   GRANT USAGE ON SCHEMA public TO hesba_service; Identical to step 2 of
-- migration 20261113000000_remove_migrator_tenant_bypass; safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_service') THEN
    RAISE NOTICE 'hesba_service does not exist: catalog-promotion cron stays disabled until it is created and scripts/sql/10-service-role-grants.sql is run';
    RETURN;
  END IF;

  GRANT USAGE ON SCHEMA public TO hesba_service;
  GRANT SELECT ON "stores", "candidate_adoptions" TO hesba_service;
  GRANT SELECT, INSERT, UPDATE ON "catalog_notifications" TO hesba_service;
  GRANT SELECT ON "store_products", "store_variants" TO hesba_service;
  GRANT UPDATE ("global_product_id", "updated_at") ON "store_products" TO hesba_service;
  GRANT UPDATE ("global_variant_id", "updated_at") ON "store_variants" TO hesba_service;
  GRANT SELECT, INSERT, UPDATE ON "catalog_candidates", "brands", "global_products", "global_variants" TO hesba_service;

  DROP POLICY IF EXISTS "service_catalog_cron" ON "stores";
  CREATE POLICY "service_catalog_cron" ON "stores" FOR SELECT TO hesba_service USING (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "candidate_adoptions";
  CREATE POLICY "service_catalog_cron" ON "candidate_adoptions" FOR SELECT TO hesba_service USING (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "catalog_notifications";
  CREATE POLICY "service_catalog_cron" ON "catalog_notifications" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "store_products";
  CREATE POLICY "service_catalog_cron" ON "store_products" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "store_variants";
  CREATE POLICY "service_catalog_cron" ON "store_variants" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "catalog_candidates";
  CREATE POLICY "service_catalog_cron" ON "catalog_candidates" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "brands";
  CREATE POLICY "service_catalog_cron" ON "brands" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "global_products";
  CREATE POLICY "service_catalog_cron" ON "global_products" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS "service_catalog_cron" ON "global_variants";
  CREATE POLICY "service_catalog_cron" ON "global_variants" FOR ALL TO hesba_service USING (true) WITH CHECK (true);
END $$;
