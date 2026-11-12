-- AI product scanner, per-shop scanner quotas, platform-wide AI limits, usage tracking and the
-- admin audit (ADR-0030). Additive: new tables only; no existing row or column is touched.
--
-- Who may do what:
-- - Shop tables (`ai_scanner_shop_quotas`, `ai_scan_operations`, `ai_usage_events`) are FORCE RLS
--   per `store_id`, like every tenant table. A platform admin may also read them (and write the
--   quota rows) when BOTH the transaction says so (`app.platform_admin = 'on'`) AND the acting
--   user (`app.user_id`) is listed in `platform_admins`. That list is written by Hesba staff
--   only (SQL as the migrator); the app role can read its own row, nothing else.
-- - Platform counters (`ai_capacity_minutes`, `ai_inflight`, `ai_budget_months`,
--   `ai_provider_health`) hold no shop data (no store id, no content): every request may update
--   them, which is how one shared limit is enforced across all shops and server instances.
-- - `ai_platform_settings` (one row) is readable by the app; only an admin may change it.
-- - `ai_admin_audit` is append-only and admin-only.

-- 1. Platform admins (staff-managed) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_admins" (
    "user_id" UUID NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "platform_admins_read_self" ON "platform_admins";
CREATE POLICY "platform_admins_read_self" ON "platform_admins" AS PERMISSIVE FOR SELECT TO public
    USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- True only inside a transaction opened by `withPlatformAdmin` for a listed admin.
CREATE OR REPLACE FUNCTION hesba_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.platform_admin', true) = 'on'
     AND EXISTS (
       SELECT 1 FROM "platform_admins"
        WHERE "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
     );
$$;

-- An admin can list shops (id, name) to manage their quotas. Read-only.
DROP POLICY IF EXISTS "stores_platform_admin_read" ON "stores";
CREATE POLICY "stores_platform_admin_read" ON "stores" AS PERMISSIVE FOR SELECT TO public
    USING (hesba_is_platform_admin());

-- The assistant's daily message counts, for the admin overview. Read-only.
DROP POLICY IF EXISTS "ai_usage_platform_admin_read" ON "ai_usage";
CREATE POLICY "ai_usage_platform_admin_read" ON "ai_usage" AS PERMISSIVE FOR SELECT TO public
    USING (hesba_is_platform_admin());

-- 2. Platform settings (one row) -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_platform_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "scanner_enabled" BOOLEAN NOT NULL DEFAULT true,
    "assistant_enabled" BOOLEAN NOT NULL DEFAULT true,
    "scanner_daily_default" INTEGER NOT NULL DEFAULT 10,
    "scanner_monthly_default" INTEGER NOT NULL DEFAULT 200,
    "scanner_max_images" INTEGER NOT NULL DEFAULT 6,
    "scanner_rpm" INTEGER NOT NULL DEFAULT 10,
    "assistant_rpm" INTEGER NOT NULL DEFAULT 10,
    "scanner_max_concurrent" INTEGER NOT NULL DEFAULT 4,
    "assistant_max_concurrent" INTEGER NOT NULL DEFAULT 4,
    "shop_rpm" INTEGER NOT NULL DEFAULT 3,
    "monthly_budget_micros" BIGINT NOT NULL DEFAULT 0,
    "scanner_cost_estimate_micros" BIGINT NOT NULL DEFAULT 0,
    "assistant_cost_estimate_micros" BIGINT NOT NULL DEFAULT 0,
    "warning_threshold_pct" INTEGER NOT NULL DEFAULT 80,
    "breaker_failure_threshold" INTEGER NOT NULL DEFAULT 5,
    "breaker_cooldown_seconds" INTEGER NOT NULL DEFAULT 60,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    CONSTRAINT "ai_platform_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_ai_platform_settings_single" CHECK ("id" = 1),
    CONSTRAINT "chk_ai_platform_settings_bounds" CHECK (
        "scanner_daily_default" BETWEEN 0 AND 100000
        AND "scanner_monthly_default" BETWEEN 0 AND 10000000
        AND "scanner_max_images" BETWEEN 1 AND 10
        AND "scanner_rpm" BETWEEN 0 AND 100000
        AND "assistant_rpm" BETWEEN 0 AND 100000
        AND "scanner_max_concurrent" BETWEEN 0 AND 1000
        AND "assistant_max_concurrent" BETWEEN 0 AND 1000
        AND "shop_rpm" BETWEEN 1 AND 1000
        AND "monthly_budget_micros" >= 0
        AND "scanner_cost_estimate_micros" >= 0
        AND "assistant_cost_estimate_micros" >= 0
        AND "warning_threshold_pct" BETWEEN 1 AND 100
        AND "breaker_failure_threshold" BETWEEN 1 AND 1000
        AND "breaker_cooldown_seconds" BETWEEN 5 AND 86400
    )
);
INSERT INTO "ai_platform_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "ai_platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_platform_settings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_platform_settings_read" ON "ai_platform_settings";
CREATE POLICY "ai_platform_settings_read" ON "ai_platform_settings" AS PERMISSIVE FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "ai_platform_settings_admin_update" ON "ai_platform_settings";
CREATE POLICY "ai_platform_settings_admin_update" ON "ai_platform_settings" AS PERMISSIVE FOR UPDATE TO public
    USING (hesba_is_platform_admin()) WITH CHECK (hesba_is_platform_admin());

-- 3. Platform counters (no shop data) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_capacity_minutes" (
    "feature" TEXT NOT NULL,
    "minute" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ai_capacity_minutes_pkey" PRIMARY KEY ("feature", "minute"),
    CONSTRAINT "chk_ai_capacity_minutes_feature" CHECK ("feature" IN ('scanner', 'assistant')),
    CONSTRAINT "chk_ai_capacity_minutes_count" CHECK ("count" >= 0)
);

CREATE TABLE IF NOT EXISTS "ai_inflight" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feature" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "ai_inflight_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_ai_inflight_feature" CHECK ("feature" IN ('scanner', 'assistant'))
);
CREATE INDEX IF NOT EXISTS "idx_ai_inflight_feature_expires" ON "ai_inflight" ("feature", "expires_at");

CREATE TABLE IF NOT EXISTS "ai_budget_months" (
    "month" DATE NOT NULL,
    "reserved_micros" BIGINT NOT NULL DEFAULT 0,
    "spent_micros" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_budget_months_pkey" PRIMARY KEY ("month"),
    CONSTRAINT "chk_ai_budget_months_nonneg" CHECK ("reserved_micros" >= 0 AND "spent_micros" >= 0)
);

CREATE TABLE IF NOT EXISTS "ai_provider_health" (
    "feature" TEXT NOT NULL,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "open_until" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "last_failure_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("feature"),
    CONSTRAINT "chk_ai_provider_health_feature" CHECK ("feature" IN ('scanner', 'assistant'))
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_capacity_minutes', 'ai_inflight', 'ai_budget_months', 'ai_provider_health'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "platform_counter_all" ON %I', t);
    EXECUTE format('CREATE POLICY "platform_counter_all" ON %I AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- 4. Per-shop scanner quota (overrides; absent row = platform defaults) ----------------------
CREATE TABLE IF NOT EXISTS "ai_scanner_shop_quotas" (
    "store_id" UUID NOT NULL,
    "daily_limit" INTEGER,
    "monthly_limit" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "bonus_credits" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    CONSTRAINT "ai_scanner_shop_quotas_pkey" PRIMARY KEY ("store_id"),
    CONSTRAINT "ai_scanner_shop_quotas_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chk_ai_scanner_shop_quotas_bounds" CHECK (
        ("daily_limit" IS NULL OR "daily_limit" BETWEEN 0 AND 100000)
        AND ("monthly_limit" IS NULL OR "monthly_limit" BETWEEN 0 AND 10000000)
        AND "bonus_credits" BETWEEN 0 AND 10000000
    )
);

-- 5. One scan operation = one submitted batch of images (no image is stored) ----------------
CREATE TABLE IF NOT EXISTS "ai_scan_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "op_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "day" DATE NOT NULL,
    "month" DATE NOT NULL,
    "uses_bonus" BOOLEAN NOT NULL DEFAULT false,
    "image_count" INTEGER NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "error_category" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    CONSTRAINT "ai_scan_operations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_scan_operations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chk_ai_scan_operations_status" CHECK ("status" IN ('reserved', 'succeeded', 'failed')),
    CONSTRAINT "chk_ai_scan_operations_images" CHECK ("image_count" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_scan_operations_store_op" ON "ai_scan_operations" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_ai_scan_operations_store_day" ON "ai_scan_operations" ("store_id", "day");
CREATE INDEX IF NOT EXISTS "idx_ai_scan_operations_store_month" ON "ai_scan_operations" ("store_id", "month");

-- 6. Usage events (both features; no prompt or image content) -------------------------------
CREATE TABLE IF NOT EXISTS "ai_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "request_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error_category" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "image_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "actual_cost_micros" BIGINT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chk_ai_usage_events_feature" CHECK ("feature" IN ('scanner', 'assistant')),
    CONSTRAINT "chk_ai_usage_events_status" CHECK ("status" IN ('succeeded', 'failed', 'rejected'))
);
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_created" ON "ai_usage_events" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_events_store_created" ON "ai_usage_events" ("store_id", "created_at");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_scanner_shop_quotas', 'ai_scan_operations', 'ai_usage_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I', t);
    EXECUTE format($p$CREATE POLICY "tenant_isolation" ON %I
        USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
        WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS "platform_admin_read" ON %I', t);
    EXECUTE format('CREATE POLICY "platform_admin_read" ON %I AS PERMISSIVE FOR SELECT TO public USING (hesba_is_platform_admin())', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS "platform_admin_write" ON "ai_scanner_shop_quotas";
CREATE POLICY "platform_admin_write" ON "ai_scanner_shop_quotas" AS PERMISSIVE FOR ALL TO public
    USING (hesba_is_platform_admin()) WITH CHECK (hesba_is_platform_admin());
-- The retention job clears stored scan results (product descriptions only) after 7 days.
DROP POLICY IF EXISTS "maintenance_read" ON "ai_scan_operations";
CREATE POLICY "maintenance_read" ON "ai_scan_operations" AS PERMISSIVE FOR SELECT TO public
    USING (current_setting('app.is_maintenance', true) = 'true');
DROP POLICY IF EXISTS "maintenance_clear_results" ON "ai_scan_operations";
CREATE POLICY "maintenance_clear_results" ON "ai_scan_operations" AS PERMISSIVE FOR UPDATE TO public
    USING (current_setting('app.is_maintenance', true) = 'true')
    WITH CHECK (current_setting('app.is_maintenance', true) = 'true' AND "result" IS NULL);

-- 7. Admin audit (append-only) ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ai_admin_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_user_id" UUID NOT NULL,
    "target_store_id" UUID,
    "action" TEXT NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_admin_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_admin_audit_admin_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ai_admin_audit_store_fkey" FOREIGN KEY ("target_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "chk_ai_admin_audit_reason" CHECK ("reason" IS NULL OR length("reason") <= 500)
);
CREATE INDEX IF NOT EXISTS "idx_ai_admin_audit_created" ON "ai_admin_audit" ("created_at" DESC);
ALTER TABLE "ai_admin_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_admin_audit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_admin_audit_admin_read" ON "ai_admin_audit";
CREATE POLICY "ai_admin_audit_admin_read" ON "ai_admin_audit" AS PERMISSIVE FOR SELECT TO public
    USING (hesba_is_platform_admin());
DROP POLICY IF EXISTS "ai_admin_audit_admin_insert" ON "ai_admin_audit";
CREATE POLICY "ai_admin_audit_admin_insert" ON "ai_admin_audit" AS PERMISSIVE FOR INSERT TO public
    WITH CHECK (hesba_is_platform_admin()
        AND "admin_user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- 8. Grants ----------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    GRANT SELECT ON "platform_admins" TO hesba_app;
    GRANT SELECT, UPDATE ON "ai_platform_settings" TO hesba_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_capacity_minutes", "ai_inflight" TO hesba_app;
    GRANT SELECT, INSERT, UPDATE ON "ai_budget_months", "ai_provider_health" TO hesba_app;
    GRANT SELECT, INSERT, UPDATE ON "ai_scanner_shop_quotas" TO hesba_app;
    GRANT SELECT, INSERT, UPDATE ON "ai_scan_operations" TO hesba_app;
    GRANT SELECT, INSERT ON "ai_usage_events" TO hesba_app;
    GRANT SELECT, INSERT ON "ai_admin_audit" TO hesba_app;
    GRANT EXECUTE ON FUNCTION hesba_is_platform_admin() TO hesba_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_migrator') THEN
    DROP POLICY IF EXISTS "platform_admins_migrator_all" ON "platform_admins";
    CREATE POLICY "platform_admins_migrator_all" ON "platform_admins" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS "ai_platform_settings_migrator_all" ON "ai_platform_settings";
    CREATE POLICY "ai_platform_settings_migrator_all" ON "ai_platform_settings" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);
  END IF;
END $$;
