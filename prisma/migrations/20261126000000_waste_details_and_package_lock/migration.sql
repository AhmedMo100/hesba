-- Damaged goods as one recorded, reviewable operation, and the shop's package locked for the app.
-- Additive only: new nullable columns, a wider reason list, a trigger and an admin function.
-- No existing row is rewritten or removed.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 1. «التالف»: who recorded it, from where, and what it was at that moment
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- created_by: the user who recorded it (kept when the user is removed: SET NULL).
ALTER TABLE "waste_records" ADD COLUMN IF NOT EXISTS "created_by" UUID;
ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "waste_records_created_by_fkey";
ALTER TABLE "waste_records" ADD CONSTRAINT "waste_records_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;

-- source: the screen it was recorded from (older rows: NULL = not recorded).
ALTER TABLE "waste_records" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "chk_waste_records_source";
ALTER TABLE "waste_records" ADD CONSTRAINT "chk_waste_records_source"
  CHECK ("source" IS NULL OR "source" IN ('alerts', 'products', 'stock', 'stocktake', 'return'));

-- Snapshots, so the log stays readable after the product is renamed or archived.
ALTER TABLE "waste_records" ADD COLUMN IF NOT EXISTS "product_name" TEXT;
ALTER TABLE "waste_records" ADD COLUMN IF NOT EXISTS "quantity_text" TEXT;
ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "chk_waste_records_snapshots";
ALTER TABLE "waste_records" ADD CONSTRAINT "chk_waste_records_snapshots"
  CHECK ((product_name IS NULL OR length(product_name) <= 200)
     AND (quantity_text IS NULL OR length(quantity_text) <= 120));

-- The owner's reasons (2026-11-26) next to the existing ones (still used by the stocktake and
-- returns, and present in history).
ALTER TABLE "waste_records" DROP CONSTRAINT IF EXISTS "chk_waste_records_reason";
ALTER TABLE "waste_records" ADD CONSTRAINT "chk_waste_records_reason"
  CHECK ("reason" IN ('expired', 'damaged', 'missing', 'damaged_return', 'other',
                      'near_expiry', 'storage_damage', 'broken_leak', 'poor_storage',
                      'supplier_damage'));

-- The log is history: the app writes a record and its cost once, and never deletes it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    REVOKE UPDATE, DELETE ON "waste_records" FROM hesba_app;
    GRANT SELECT, INSERT ON "waste_records" TO hesba_app;
    GRANT UPDATE ("cost_minor") ON "waste_records" TO hesba_app;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 2. The package (operating_mode) is changed by Hesba's administration only
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- The app role can no longer change a shop's package, whatever request reaches the server.
-- Sign-up still sets it once (an INSERT). Administration changes it with
-- hesba_set_operating_mode below (SECURITY DEFINER, not callable by the app).
CREATE OR REPLACE FUNCTION hesba_stores_operating_mode_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."operating_mode" IS DISTINCT FROM OLD."operating_mode"
     AND current_user IN ('hesba_app', 'hesba_service') THEN
    RAISE EXCEPTION 'operating_mode is changed by Hesba administration only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "hesba_stores_operating_mode_locked" ON "stores";
CREATE TRIGGER "hesba_stores_operating_mode_locked"
  BEFORE UPDATE OF "operating_mode" ON "stores"
  FOR EACH ROW EXECUTE FUNCTION hesba_stores_operating_mode_locked();

-- Administration: SELECT * FROM hesba_set_operating_mode('<store uuid>', 'simple' | 'pos');
CREATE OR REPLACE FUNCTION hesba_set_operating_mode(p_store_id UUID, p_mode TEXT)
RETURNS TABLE (store_id UUID, operating_mode TEXT, operating_mode_changed_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_mode NOT IN ('simple', 'pos') THEN
    RAISE EXCEPTION 'mode must be simple or pos';
  END IF;
  PERFORM set_config('app.store_id', p_store_id::text, true);
  UPDATE "stores" AS st
     SET "operating_mode" = p_mode,
         "operating_mode_changed_at" = CASE WHEN st."operating_mode" = p_mode
                                            THEN st."operating_mode_changed_at" ELSE now() END
   WHERE st."id" = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store % not found', p_store_id;
  END IF;
  RETURN QUERY
    SELECT s."id", s."operating_mode", s."operating_mode_changed_at"
      FROM "stores" s WHERE s."id" = p_store_id;
END $$;

REVOKE ALL ON FUNCTION hesba_set_operating_mode(UUID, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    REVOKE ALL ON FUNCTION hesba_set_operating_mode(UUID, TEXT) FROM hesba_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_service') THEN
    REVOKE ALL ON FUNCTION hesba_set_operating_mode(UUID, TEXT) FROM hesba_service;
  END IF;
END $$;
