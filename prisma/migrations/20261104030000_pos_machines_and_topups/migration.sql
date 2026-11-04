-- Migration: 20261104030000_pos_machines_and_topups
-- POS Payment Machines & Topups with Row Level Security (RLS)

CREATE TABLE IF NOT EXISTS "pos_machines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "terminal_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "current_balance_piasters" BIGINT NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_machines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_machines_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_pos_machines_store_deleted" ON "pos_machines" ("store_id", "deleted_at");

ALTER TABLE "pos_machines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_machines" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "pos_machines";
CREATE POLICY "tenant_isolation" ON "pos_machines"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "pos_machines_migrator_all" ON "pos_machines";
CREATE POLICY "pos_machines_migrator_all" ON "pos_machines"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_machines" TO hesba_app;

CREATE TABLE IF NOT EXISTS "pos_machine_topups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "machine_id" UUID NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    "balance_after_piasters" BIGINT NOT NULL,
    "source" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_machine_topups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pos_machine_topups_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pos_machine_topups_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "pos_machines"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_pos_machine_topups_store_machine" ON "pos_machine_topups" ("store_id", "machine_id", "created_at" DESC);

ALTER TABLE "pos_machine_topups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pos_machine_topups" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "pos_machine_topups";
CREATE POLICY "tenant_isolation" ON "pos_machine_topups"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "pos_machine_topups_migrator_all" ON "pos_machine_topups";
CREATE POLICY "pos_machine_topups_migrator_all" ON "pos_machine_topups"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "pos_machine_topups" TO hesba_app;
