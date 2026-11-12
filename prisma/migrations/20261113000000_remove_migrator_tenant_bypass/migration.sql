-- QA-34 (ADR-0024): the migrator role no longer bypasses tenant isolation by policy, and the
-- one cross-store background job (catalog promotion) runs as a dedicated least-privilege
-- service role instead of the migrator.
--
-- No data is read, changed or deleted. Only policies and grants change.

-- 1. Drop every "<table>_migrator_all" policy (USING true for hesba_migrator) on TENANT tables
--    (tables with a store_id column, and `stores` itself). The migrator owns the tables and
--    FORCE ROW LEVEL SECURITY applies to owners, so from now on it sees a shop's rows only with
--    that shop's `app.store_id` set — like the application. Global catalog tables (no store_id:
--    brands, global_products, global_variants, prepaid_products, bill_providers,
--    commission_rules, catalog_candidates) keep their migrator policy: importing the global
--    catalog is the migrator's documented job (`pnpm catalog:import`).
--
--    A future migration that must touch every shop's rows lifts FORCE for that table INSIDE its
--    own transaction (`ALTER TABLE … NO FORCE ROW LEVEL SECURITY; …; ALTER TABLE … FORCE …`):
--    the elevation exists only in the migration context (ADR-0024).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT p.tablename, p.policyname
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.policyname = p.tablename || '_migrator_all'
       AND (
         p.tablename = 'stores'
         OR EXISTS (
           SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = p.tablename
              AND c.column_name = 'store_id'
         )
       )
  LOOP
    EXECUTE format('DROP POLICY %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- 2. The service role used ONLY by the catalog-promotion cron (HESBA_SERVICE_DATABASE_URL).
--    Creating a role needs a superuser, so it is created by `scripts/sql/00-roles.sql` (local,
--    CI) or by the database owner (Neon / production, an authorized manual step). When the
--    role exists, it gets exactly what the job needs, and nothing else:
--      read      stores, candidate_adoptions               (which shops adopted / to notify)
--      write     catalog_notifications                     (one notification per shop)
--      link      store_products.global_product_id, store_variants.global_variant_id
--      global    catalog_candidates, brands, global_products, global_variants
--    No DELETE anywhere, no access to sales, stock, money, people or any other shop data.
--    Re-runnable: `scripts/sql/10-service-role-grants.sql` holds the same statements, for a
--    database where the role is created after this migration ran.
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
