-- Damaged / lost goods (P4): a waste record gets a documented reason, an optional note, and —
-- for goods returned damaged — the return it came from. Additive; no existing row is changed
-- (the reason CHECK is NOT VALID, so older free-text reasons stay readable).

ALTER TABLE "waste_records" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "waste_records" ADD COLUMN IF NOT EXISTS "sale_return_id" UUID;

ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "chk_waste_records_reason";
ALTER TABLE "waste_records" ADD CONSTRAINT "chk_waste_records_reason"
  CHECK ("reason" IN ('expired', 'damaged', 'missing', 'damaged_return', 'other')) NOT VALID;
ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "chk_waste_records_note";
ALTER TABLE "waste_records" ADD CONSTRAINT "chk_waste_records_note"
  CHECK ("note" IS NULL OR length("note") <= 500) NOT VALID;

-- Same-store reference to the return (a row can only point at a return of its own store).
ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "waste_records_sale_return_fkey";
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_sale_return_fkey"
  FOREIGN KEY ("store_id", "sale_return_id") REFERENCES "sale_returns"("store_id", "id")
  ON DELETE SET NULL ("sale_return_id") ON UPDATE CASCADE;

-- The Home losses report reads a store's waste by date.
CREATE INDEX IF NOT EXISTS "idx_waste_records_store_created"
  ON "waste_records" ("store_id", "created_at" DESC);
