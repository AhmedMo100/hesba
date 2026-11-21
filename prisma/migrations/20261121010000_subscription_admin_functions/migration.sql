-- Migration: 20261121010000_subscription_admin_functions (ADR-0033, docs/ops/subscriptions.md)
-- Hesba's manual subscription operations, for its admin only (EXECUTE revoked from everyone
-- else, never callable by the app's roles). `stores` and `store_members` have FORCE RLS, so the
-- functions bind the tenant themselves to the one shop / owner they act on.

-- Finds a shop by its owner's phone (01xxxxxxxxx or +201xxxxxxxxx — stored as +20…) or e-mail,
-- with its subscription.
CREATE OR REPLACE FUNCTION hesba_find_store(p_phone_or_email TEXT)
RETURNS TABLE (
  store_id UUID,
  store_name TEXT,
  owner_name TEXT,
  owner_phone TEXT,
  operating_mode TEXT,
  subscription_status TEXT,
  subscription_plan TEXT,
  trial_ends_at TIMESTAMPTZ,
  subscription_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u RECORD;
  q TEXT := regexp_replace(trim(p_phone_or_email), '[\s-]', '', 'g');
  v_phone TEXT := CASE WHEN q ~ '^01[0125][0-9]{8}$' THEN '+20' || substr(q, 2) ELSE q END;
BEGIN
  FOR u IN
    SELECT "id", "name", "phone" FROM "users"
     WHERE "users"."phone" = v_phone
        OR lower("email") = lower(trim(p_phone_or_email))
  LOOP
    PERFORM set_config('app.user_id', u.id::text, true);
    RETURN QUERY
      SELECT s."id", s."name", u.name, u.phone, s."operating_mode", s."subscription_status",
             s."subscription_plan", s."trial_ends_at", s."subscription_ends_at", s."created_at"
        FROM "stores" s
        JOIN "store_members" m ON m."store_id" = s."id"
       WHERE m."user_id" = u.id;
  END LOOP;
END $$;

-- Sets a shop's status without touching its dates: 'suspended' stops it at once, 'expired' ends
-- it now. (Activation and renewal go through hesba_renew_subscription, which sets the dates.)
CREATE OR REPLACE FUNCTION hesba_set_subscription_status(p_store_id UUID, p_status TEXT)
RETURNS TABLE (store_id UUID, subscription_status TEXT, subscription_ends_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('suspended', 'expired') THEN
    RAISE EXCEPTION 'status must be suspended or expired (use hesba_renew_subscription to activate)';
  END IF;
  PERFORM set_config('app.store_id', p_store_id::text, true);
  UPDATE "stores" SET "subscription_status" = p_status WHERE "id" = p_store_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'store % not found', p_store_id;
  END IF;
  RETURN QUERY
    SELECT s."id", s."subscription_status", s."subscription_ends_at"
      FROM "stores" s WHERE s."id" = p_store_id;
END $$;

REVOKE ALL ON FUNCTION hesba_find_store(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION hesba_set_subscription_status(UUID, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    REVOKE ALL ON FUNCTION hesba_find_store(TEXT) FROM hesba_app;
    REVOKE ALL ON FUNCTION hesba_set_subscription_status(UUID, TEXT) FROM hesba_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_service') THEN
    REVOKE ALL ON FUNCTION hesba_find_store(TEXT) FROM hesba_service;
    REVOKE ALL ON FUNCTION hesba_set_subscription_status(UUID, TEXT) FROM hesba_service;
  END IF;
END $$;
