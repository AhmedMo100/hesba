-- Migration: 20261121000000_operating_modes_subscriptions (ADR-0033)
-- Additive only: no row is deleted and no existing value changes meaning.
--
-- 1. stores.operating_mode: 'simple' (إدارة المحل) | 'pos' (الكاشير الذكي).
-- 2. The shop's subscription on its own row (one per shop, read with the session in the query
--    that already loads the shop): status, plan, the trial and the paid period.
-- 3. A guard: the runtime roles can never change a subscription field, and a shop the app
--    creates always starts a 72-hour trial from the DATABASE clock (no client date counts).
-- 4. store_subscription_events: every change of a subscription field, by whom (manual
--    activations included).
-- 5. hesba_renew_subscription(): the safe manual activation / renewal (admins only).
-- 6. daily_sales_entries (+ parts): إدارة المحل's daily sales total, split by payment.
--
-- Existing shops (policy decided by the owner, 2026-11-21): they keep working as they do today —
-- operating_mode 'pos', status 'active', plan 'legacy', paid until the end of 2026-11-22 Cairo
-- time (2026-11-22 22:00 UTC). They never get a trial, and an empty end date never means
-- "forever" (CHECK constraints below).
--
-- `stores` has FORCE ROW LEVEL SECURITY, so existing rows are filled by ADD COLUMN ... DEFAULT
-- (DDL, not subject to RLS); the defaults are then changed for new shops.

-- ─── 1–2. Columns (existing rows get the legacy values) ─────────────────────────────────────
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "operating_mode" TEXT NOT NULL DEFAULT 'pos';
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "operating_mode_changed_at" TIMESTAMPTZ(6);
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "subscription_status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "subscription_plan" TEXT DEFAULT 'legacy';
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "trial_started_at" TIMESTAMPTZ(6);
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMPTZ(6);
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "subscription_started_at" TIMESTAMPTZ(6) DEFAULT now();
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "subscription_ends_at" TIMESTAMPTZ(6)
  DEFAULT '2026-11-22 22:00:00+00';

-- New shops: a trial (the guard below fills its dates), no plan, no paid period.
ALTER TABLE "stores" ALTER COLUMN "subscription_status" SET DEFAULT 'trialing';
ALTER TABLE "stores" ALTER COLUMN "subscription_plan" DROP DEFAULT;
ALTER TABLE "stores" ALTER COLUMN "subscription_started_at" DROP DEFAULT;
ALTER TABLE "stores" ALTER COLUMN "subscription_ends_at" DROP DEFAULT;

ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_operating_mode_check";
ALTER TABLE "stores" ADD CONSTRAINT "stores_operating_mode_check"
  CHECK ("operating_mode" IN ('simple', 'pos'));
ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_subscription_status_check";
ALTER TABLE "stores" ADD CONSTRAINT "stores_subscription_status_check"
  CHECK ("subscription_status" IN ('trialing', 'active', 'expired', 'suspended'));
-- No status that grants use without its end date: NULL can never mean unlimited.
ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_trial_has_end_check";
ALTER TABLE "stores" ADD CONSTRAINT "stores_trial_has_end_check"
  CHECK ("subscription_status" <> 'trialing' OR "trial_ends_at" IS NOT NULL);
ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_active_has_end_check";
ALTER TABLE "stores" ADD CONSTRAINT "stores_active_has_end_check"
  CHECK ("subscription_status" <> 'active' OR "subscription_ends_at" IS NOT NULL);
ALTER TABLE "stores" DROP CONSTRAINT IF EXISTS "stores_subscription_period_check";
ALTER TABLE "stores" ADD CONSTRAINT "stores_subscription_period_check"
  CHECK ("subscription_started_at" IS NULL OR "subscription_ends_at" IS NULL
         OR "subscription_ends_at" > "subscription_started_at");

-- ─── 3. The guard ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hesba_stores_subscription_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  runtime boolean := current_user IN ('hesba_app', 'hesba_service');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF runtime THEN
      -- A shop created by the app: always a fresh 72-hour trial from the database clock.
      NEW.subscription_status     := 'trialing';
      NEW.subscription_plan       := NULL;
      NEW.trial_started_at        := now();
      NEW.trial_ends_at           := now() + interval '72 hours';
      NEW.subscription_started_at := NULL;
      NEW.subscription_ends_at    := NULL;
    ELSIF NEW.subscription_status = 'trialing' AND NEW.trial_ends_at IS NULL THEN
      NEW.trial_started_at := COALESCE(NEW.trial_started_at, now());
      NEW.trial_ends_at    := NEW.trial_started_at + interval '72 hours';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: the runtime roles may change anything about the shop but its subscription.
  IF runtime AND (
       NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_plan       IS DISTINCT FROM OLD.subscription_plan
    OR NEW.trial_started_at        IS DISTINCT FROM OLD.trial_started_at
    OR NEW.trial_ends_at           IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.subscription_started_at IS DISTINCT FROM OLD.subscription_started_at
    OR NEW.subscription_ends_at    IS DISTINCT FROM OLD.subscription_ends_at
  ) THEN
    RAISE EXCEPTION 'subscription fields are managed by Hesba only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "stores_subscription_guard" ON "stores";
CREATE TRIGGER "stores_subscription_guard"
  BEFORE INSERT OR UPDATE ON "stores"
  FOR EACH ROW EXECUTE FUNCTION hesba_stores_subscription_guard();

-- ─── 4. The audit of subscription changes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "store_subscription_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "changed_by" TEXT NOT NULL,
  "old_status" TEXT,
  "new_status" TEXT,
  "old_plan" TEXT,
  "new_plan" TEXT,
  "old_ends_at" TIMESTAMPTZ(6),
  "new_ends_at" TIMESTAMPTZ(6),
  "old_trial_ends_at" TIMESTAMPTZ(6),
  "new_trial_ends_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "store_subscription_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_subscription_events_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_store_subscription_events_store_at"
  ON "store_subscription_events" ("store_id", "created_at" DESC);
-- A tenant table like the others (FORCE RLS, tenant isolation, no migrator bypass), and Hesba's
-- own: the runtime roles neither read nor write it.
ALTER TABLE "store_subscription_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_subscription_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "store_subscription_events";
CREATE POLICY "tenant_isolation" ON "store_subscription_events"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    REVOKE ALL ON "store_subscription_events" FROM hesba_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_service') THEN
    REVOKE ALL ON "store_subscription_events" FROM hesba_service;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION hesba_stores_subscription_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bound TEXT := current_setting('app.store_id', true);
BEGIN
  IF NEW.subscription_status     IS DISTINCT FROM OLD.subscription_status
  OR NEW.subscription_plan       IS DISTINCT FROM OLD.subscription_plan
  OR NEW.subscription_ends_at    IS DISTINCT FROM OLD.subscription_ends_at
  OR NEW.subscription_started_at IS DISTINCT FROM OLD.subscription_started_at
  OR NEW.trial_ends_at           IS DISTINCT FROM OLD.trial_ends_at THEN
    PERFORM set_config('app.store_id', NEW.id::text, true);
    INSERT INTO "store_subscription_events" (
      "store_id", "changed_by", "old_status", "new_status", "old_plan", "new_plan",
      "old_ends_at", "new_ends_at", "old_trial_ends_at", "new_trial_ends_at")
    VALUES (NEW.id, session_user, OLD.subscription_status, NEW.subscription_status,
      OLD.subscription_plan, NEW.subscription_plan, OLD.subscription_ends_at,
      NEW.subscription_ends_at, OLD.trial_ends_at, NEW.trial_ends_at);
    -- Bound to this shop only for the audit row (FORCE RLS), then back as it was.
    PERFORM set_config('app.store_id', COALESCE(bound, ''), true);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hesba_stores_subscription_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS "stores_subscription_audit" ON "stores";
CREATE TRIGGER "stores_subscription_audit"
  AFTER UPDATE ON "stores"
  FOR EACH ROW EXECUTE FUNCTION hesba_stores_subscription_audit();

-- ─── 5. Manual activation / renewal (docs/ops/subscriptions.md) ────────────────────────────
-- Adds p_months to the paid period: from the current end while it is still in the future (no
-- remaining day is lost, whatever the current status), else from now. Sets the shop active. Run by Hesba's admin only:
-- EXECUTE is revoked from everyone else, and the function binds the tenant to that one shop.
CREATE OR REPLACE FUNCTION hesba_renew_subscription(
  p_store_id UUID,
  p_months INTEGER,
  p_plan TEXT DEFAULT NULL
) RETURNS TABLE (
  store_id UUID,
  subscription_status TEXT,
  subscription_plan TEXT,
  subscription_started_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  still_paid boolean;
BEGIN
  IF p_months IS NULL OR p_months < 1 OR p_months > 36 THEN
    RAISE EXCEPTION 'months must be between 1 and 36';
  END IF;
  PERFORM set_config('app.store_id', p_store_id::text, true);
  SELECT * INTO s FROM "stores" WHERE "id" = p_store_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store % not found', p_store_id;
  END IF;
  -- Paid days still ahead (whatever the status: a suspended or manually expired shop keeps
  -- them) are never lost: the new period is added after them.
  still_paid := s.subscription_ends_at IS NOT NULL
                AND s.subscription_ends_at > now();
  UPDATE "stores" AS t SET
    "subscription_status"     = 'active',
    "subscription_plan"       = COALESCE(p_plan, t."subscription_plan", 'monthly'),
    "subscription_started_at" = CASE WHEN still_paid THEN t."subscription_started_at" ELSE now() END,
    "subscription_ends_at"    = (CASE WHEN still_paid THEN t."subscription_ends_at" ELSE now() END)
                                + make_interval(months => p_months)
  WHERE t."id" = p_store_id;
  RETURN QUERY
    SELECT t."id", t."subscription_status", t."subscription_plan",
           t."subscription_started_at", t."subscription_ends_at"
    FROM "stores" t WHERE t."id" = p_store_id;
END $$;
REVOKE ALL ON FUNCTION hesba_renew_subscription(UUID, INTEGER, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    REVOKE ALL ON FUNCTION hesba_renew_subscription(UUID, INTEGER, TEXT) FROM hesba_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_service') THEN
    REVOKE ALL ON FUNCTION hesba_renew_subscription(UUID, INTEGER, TEXT) FROM hesba_service;
  END IF;
END $$;

-- ─── 6. إدارة المحل: the daily sales total ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "daily_sales_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "op_id" UUID NOT NULL,
  -- The Cairo business day the total is for.
  "business_day" DATE NOT NULL,
  "total_piasters" BIGINT NOT NULL,
  -- The part paid in cash: it counts in the drawer.
  "cash_piasters" BIGINT NOT NULL DEFAULT 0,
  "note" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Cancelled entries stay on record (audit) and count nowhere.
  "cancelled_at" TIMESTAMPTZ(6),
  CONSTRAINT "daily_sales_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_sales_entries_amounts_check"
    CHECK ("total_piasters" > 0 AND "cash_piasters" >= 0 AND "cash_piasters" <= "total_piasters"),
  CONSTRAINT "daily_sales_entries_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_sales_entries_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_daily_sales_entries_store_op"
  ON "daily_sales_entries" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_daily_sales_entries_store_day"
  ON "daily_sales_entries" ("store_id", "business_day" DESC);

-- The parts paid into the shop's machines / wallets (each raised that machine's balance).
CREATE TABLE IF NOT EXISTS "daily_sales_entry_parts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "entry_id" UUID NOT NULL,
  "machine_id" UUID NOT NULL,
  "amount_piasters" BIGINT NOT NULL,
  CONSTRAINT "daily_sales_entry_parts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_sales_entry_parts_amount_check" CHECK ("amount_piasters" > 0),
  CONSTRAINT "daily_sales_entry_parts_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_sales_entry_parts_entry_id_fkey" FOREIGN KEY ("entry_id")
    REFERENCES "daily_sales_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_sales_entry_parts_machine_id_fkey" FOREIGN KEY ("machine_id")
    REFERENCES "pos_machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_daily_sales_entry_parts_entry"
  ON "daily_sales_entry_parts" ("entry_id");

ALTER TABLE "daily_sales_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_sales_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "daily_sales_entries";
CREATE POLICY "tenant_isolation" ON "daily_sales_entries"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
ALTER TABLE "daily_sales_entry_parts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_sales_entry_parts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "daily_sales_entry_parts";
CREATE POLICY "tenant_isolation" ON "daily_sales_entry_parts"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    GRANT SELECT, INSERT ON "daily_sales_entries" TO hesba_app;
    -- Only the cancel mark may change; amounts and days are history.
    REVOKE UPDATE, DELETE ON "daily_sales_entries" FROM hesba_app;
    GRANT UPDATE ("cancelled_at") ON "daily_sales_entries" TO hesba_app;
    GRANT SELECT, INSERT ON "daily_sales_entry_parts" TO hesba_app;
    REVOKE UPDATE, DELETE ON "daily_sales_entry_parts" FROM hesba_app;
  END IF;
END $$;
