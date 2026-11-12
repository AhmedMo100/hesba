-- QA-10 (ADR-0022): undo a sale with a reversing void, never a delete.
--
-- `sales` stays append-only for the application role (no UPDATE, no DELETE). A void is a NEW,
-- immutable row here: one per sale (a second void is the same void), its own client op_id
-- (a retried request is applied once), who voided it and why. The stock is restored inside the
-- same transaction from the sale's recorded `stock_movements` (type 'void' movements).
--
-- No existing row is changed by this migration.

-- (store_id, id) is unique already because id is; this index lets sale_voids reference it so a
-- void can only point at a sale of its own store.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sales_store_id_id" ON "sales" ("store_id", "id");

CREATE TABLE IF NOT EXISTS "sale_voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "op_id" UUID NOT NULL,
    "reason" TEXT,
    "voided_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_voids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_voids_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_voids_sale_fkey" FOREIGN KEY ("store_id", "sale_id") REFERENCES "sales"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sale_voids_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- One void per sale; one void per client operation.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sale_voids_sale" ON "sale_voids" ("store_id", "sale_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sale_voids_store_op" ON "sale_voids" ("store_id", "op_id");

ALTER TABLE "sale_voids" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_voids" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "sale_voids";
CREATE POLICY "tenant_isolation" ON "sale_voids"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "sale_voids_migrator_all" ON "sale_voids";
CREATE POLICY "sale_voids_migrator_all" ON "sale_voids"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- Append-only, like `sales`: the application can record a void, never change or remove one.
GRANT SELECT, INSERT ON "sale_voids" TO hesba_app;
REVOKE UPDATE, DELETE ON "sale_voids" FROM hesba_app;
