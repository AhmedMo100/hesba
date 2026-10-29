-- Migration: 20261029210000_catalog_candidates_app_policy
-- Allow hesba_app to manage catalog_candidates pool

DROP POLICY IF EXISTS "catalog_candidates_app_all" ON "catalog_candidates";
CREATE POLICY "catalog_candidates_app_all" ON "catalog_candidates"
    AS PERMISSIVE FOR ALL TO hesba_app USING (true) WITH CHECK (true);
