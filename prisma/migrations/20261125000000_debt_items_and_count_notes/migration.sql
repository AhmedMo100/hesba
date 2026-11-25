-- ADR-0036: the products of a manual debt, and a note + «منتهي الصلاحية» on a stocktake line.
--
-- Additive only: one new table, one new nullable column, one wider CHECK. No existing row is
-- changed, nothing is dropped. Every new table is a shop table: FORCE ROW LEVEL SECURITY +
-- tenant_isolation, append-only for the app role.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 1. debt_entry_items: what a customer took (or what a supplier delivered) on a MANUAL debt.
--    Display and audit only: a manual debt is a balance, never a sale or a purchase, so these
--    lines move no stock, add no revenue and no cost. A credit invoice keeps its own lines
--    (sale_lines / purchase_lines) and never gets rows here.
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "debt_entry_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "debt_entry_id" UUID NOT NULL,
  -- The shop's product, when the owner picked one (kept for the link; the name is a snapshot).
  "store_variant_id" UUID,
  "name" TEXT NOT NULL,
  -- 'piece' | 'kg' | … as the product is sold: quantity_base is pieces or grams.
  "unit" TEXT NOT NULL DEFAULT 'piece',
  "quantity_base" BIGINT NOT NULL,
  -- The price the owner agreed (per piece, or per kilogram for weighed goods) and the line total.
  "unit_price_minor" BIGINT NOT NULL,
  "total_minor" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "debt_entry_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "debt_entry_items_name_check" CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT "debt_entry_items_qty_check" CHECK ("quantity_base" > 0),
  CONSTRAINT "debt_entry_items_money_check" CHECK ("unit_price_minor" >= 0 AND "total_minor" >= 0),
  CONSTRAINT "debt_entry_items_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "debt_entry_items_entry_fkey" FOREIGN KEY ("debt_entry_id")
    REFERENCES "debt_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "debt_entry_items_variant_fkey" FOREIGN KEY ("store_variant_id")
    REFERENCES "store_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_debt_entry_items_store_entry"
  ON "debt_entry_items" ("store_id", "debt_entry_id");

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 2. Stocktake lines: the owner's note («اتكسر في النقل»), and «منتهي الصلاحية» as its own
--    reason (it goes to waste_records as 'expired', the loss ledger that already has it).
-- ─────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "inventory_count_lines" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "inventory_count_lines" DROP CONSTRAINT IF EXISTS "inventory_count_lines_note_check";
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_note_check"
  CHECK ("note" IS NULL OR length("note") <= 300);
ALTER TABLE "inventory_count_lines" DROP CONSTRAINT IF EXISTS "inventory_count_lines_reason_check";
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_reason_check" CHECK (
  "reason" IS NULL OR "reason" IN ('unrecorded_sale', 'damaged', 'expired', 'lost', 'unknown', 'surplus'));

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 3. Row level security and grants
-- ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE "debt_entry_items" ENABLE ROW LEVEL SECURITY;
  ALTER TABLE "debt_entry_items" FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "tenant_isolation" ON "debt_entry_items";
  CREATE POLICY "tenant_isolation" ON "debt_entry_items"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    -- Like debt_entries: append-only (a mistake is corrected by another entry).
    GRANT SELECT, INSERT ON "debt_entry_items" TO hesba_app;
    REVOKE UPDATE, DELETE ON "debt_entry_items" FROM hesba_app;
    -- The note is written while the count is open (the frozen trigger still guards closed ones).
    GRANT UPDATE ("note") ON "inventory_count_lines" TO hesba_app;
  END IF;
END $$;
