-- Migration: 20261124000000_single_package (ADR-0035)
-- Hesba has ONE package (owner's decision, 2026-11-23): every shop works as الكاشير الذكي
-- ('pos'). Shops still on إدارة المحل ('simple') are moved to 'pos'.
--
-- Only the mode changes (operating_mode, operating_mode_changed_at). No business data is
-- touched: past daily sales totals stay in the reports, and past stocktakes keep the mode
-- they were confirmed in (inventory_counts.operating_mode), so their history is not rewritten.
-- The 'simple' value stays allowed by the CHECK (history, older rows); the app no longer sets it.
--
-- `stores` has FORCE ROW LEVEL SECURITY and the migrating role has no BYPASSRLS: a plain UPDATE
-- would silently change nothing. The table owner lifts FORCE for this one statement and puts it
-- back in the same DO block, which is atomic — if anything fails, FORCE was never lifted.
DO $$
BEGIN
  ALTER TABLE "stores" NO FORCE ROW LEVEL SECURITY;
  UPDATE "stores"
     SET "operating_mode" = 'pos',
         "operating_mode_changed_at" = CURRENT_TIMESTAMP
   WHERE "operating_mode" = 'simple';
  ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;
END $$;
