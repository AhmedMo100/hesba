-- Migration: 20261120000000_drawer_counts_paid_from_barcode (ADR-0031)
-- Additive only: no existing row changes meaning.
-- 1. An optional, shop-only barcode on store variants (amends ADR-0016: never mandatory,
--    never shared with the catalog, unique per shop when set).
-- 2. `paid_from` on money movements: 'cash' (the drawer) | 'wallet' (a wallet or machine).
--    NULL = not recorded (older rows): such movements are never counted in the drawer.
-- 3. cash_drawer_counts: the owner's counts of the drawer; the expected balance is the last
--    count plus the cash movements after it.

ALTER TABLE "store_variants" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_store_variants_store_barcode"
  ON "store_variants" ("store_id", "barcode") WHERE "barcode" IS NOT NULL;

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "paid_from" TEXT;
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "paid_from" TEXT;
ALTER TABLE "store_stock_batches" ADD COLUMN IF NOT EXISTS "paid_from" TEXT;

ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_paid_from_check";
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_from_check"
  CHECK ("paid_from" IS NULL OR "paid_from" IN ('cash', 'wallet'));
ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "debt_entries_paid_from_check";
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_paid_from_check"
  CHECK ("paid_from" IS NULL OR "paid_from" IN ('cash', 'wallet'));
ALTER TABLE "store_stock_batches" DROP CONSTRAINT IF EXISTS "store_stock_batches_paid_from_check";
ALTER TABLE "store_stock_batches" ADD CONSTRAINT "store_stock_batches_paid_from_check"
  CHECK ("paid_from" IS NULL OR "paid_from" IN ('cash', 'wallet'));

CREATE TABLE IF NOT EXISTS "cash_drawer_counts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "op_id" UUID NOT NULL,
  "counted_piasters" BIGINT NOT NULL,
  -- What the screen expected at the count; NULL for the first count (nothing to compare).
  "expected_piasters" BIGINT,
  "note" TEXT,
  "counted_by" UUID,
  "counted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_drawer_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_drawer_counts_counted_check" CHECK ("counted_piasters" >= 0),
  CONSTRAINT "cash_drawer_counts_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "cash_drawer_counts_counted_by_fkey" FOREIGN KEY ("counted_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cash_drawer_counts_store_op"
  ON "cash_drawer_counts" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_cash_drawer_counts_store_at"
  ON "cash_drawer_counts" ("store_id", "counted_at" DESC);

-- Tenant isolation (FORCE RLS); append-only for the app.
ALTER TABLE "cash_drawer_counts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_drawer_counts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "cash_drawer_counts";
CREATE POLICY "tenant_isolation" ON "cash_drawer_counts"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
-- No migrator bypass policy on a tenant table (QA-34).
DROP POLICY IF EXISTS "cash_drawer_counts_migrator_all" ON "cash_drawer_counts";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    GRANT SELECT, INSERT ON "cash_drawer_counts" TO hesba_app;
    REVOKE UPDATE, DELETE ON "cash_drawer_counts" FROM hesba_app;
  END IF;
END $$;
