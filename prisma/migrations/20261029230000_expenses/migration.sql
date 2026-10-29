-- Migration: 20261029230000_expenses
-- Expenses module table, index, RLS policies, and permissions

CREATE TABLE IF NOT EXISTS "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    "note" TEXT,
    "spent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_expenses_store_spent_at" ON "expenses" ("store_id", "spent_at" DESC);

-- RLS
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expenses" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "expenses";
CREATE POLICY "tenant_isolation" ON "expenses"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "expenses_migrator_all" ON "expenses";
CREATE POLICY "expenses_migrator_all" ON "expenses"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- Permissions for hesba_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "expenses" TO hesba_app;

