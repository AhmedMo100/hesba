-- Signup referral codes (an influencer's code such as `mogamal123`) and the shop they brought.
--
-- The smallest model, no affiliate/payment system:
-- - `referral_codes`: a global list of verified codes, managed by Hesba staff (migrator /
--   SQL). `label` (who the code belongs to) is internal and never returned to users.
-- - `store_referrals`: at most one row per shop, written in the signup transaction only.
--   Append-only for the application role, so the attribution is permanent.
-- `stores` itself is not changed (additive migration; no existing row is touched).

CREATE TABLE IF NOT EXISTS "referral_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id"),
    -- Stored lower-case: the code a user types is matched case-insensitively.
    CONSTRAINT "chk_referral_codes_code_format" CHECK ("code" ~ '^[a-z0-9_-]{3,32}$'),
    CONSTRAINT "chk_referral_codes_label" CHECK (length(btrim("label")) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_referral_codes_code" ON "referral_codes" ("code");

CREATE TABLE IF NOT EXISTS "store_referrals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "referral_code_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_referrals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "store_referrals_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- A code that brought shops cannot be deleted (deactivate it instead).
    CONSTRAINT "store_referrals_referral_code_id_fkey" FOREIGN KEY ("referral_code_id") REFERENCES "referral_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_store_referrals_store" ON "store_referrals" ("store_id");
CREATE INDEX IF NOT EXISTS "idx_store_referrals_code" ON "store_referrals" ("referral_code_id");

-- referral_codes: readable (active codes only) by the app, writable by staff only.
ALTER TABLE "referral_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "referral_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referral_codes_read_active" ON "referral_codes";
CREATE POLICY "referral_codes_read_active" ON "referral_codes" AS PERMISSIVE FOR SELECT TO public USING ("is_active");
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_migrator') THEN
    DROP POLICY IF EXISTS "referral_codes_migrator_all" ON "referral_codes";
    CREATE POLICY "referral_codes_migrator_all" ON "referral_codes" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    GRANT SELECT ON "referral_codes" TO hesba_app;
    REVOKE INSERT, UPDATE, DELETE ON "referral_codes" FROM hesba_app;
  END IF;
END $$;

-- store_referrals: tenant isolation (FORCE RLS), append-only for the app.
ALTER TABLE "store_referrals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_referrals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "store_referrals";
CREATE POLICY "tenant_isolation" ON "store_referrals"
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    GRANT SELECT, INSERT ON "store_referrals" TO hesba_app;
    REVOKE UPDATE, DELETE ON "store_referrals" FROM hesba_app;
  END IF;
END $$;
