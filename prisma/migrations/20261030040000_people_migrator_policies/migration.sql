-- Migration: 20261030040000_people_migrator_policies
-- Adds hesba_migrator bypass policies to contacts and debt_entries for smooth migrations and maintenance

DROP POLICY IF EXISTS "contacts_migrator_all" ON "contacts";
CREATE POLICY "contacts_migrator_all" ON "contacts"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "debt_entries_migrator_all" ON "debt_entries";
CREATE POLICY "debt_entries_migrator_all" ON "debt_entries"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);
