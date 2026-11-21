-- Optional e-mail at sign-up, and the manual (admin-only) password reset with a forced change.
--
-- 1. `users.email` becomes nullable. The sign-up screen has always shown the e-mail as optional,
--    but the column was NOT NULL + UNIQUE, so an account without an e-mail was stored as '' and
--    the SECOND such account collided on `users_email_key`. NULL is the honest "no e-mail":
--    Postgres UNIQUE allows any number of NULLs, and two real e-mails still cannot repeat.
--    Existing '' values become NULL (no other value is touched).
--
-- 2. `users.must_change_password` + `users.temp_password_expires_at`: set ONLY by the admin
--    reset tool (scripts/admin-reset-password.ts, run with the migrator connection). While the
--    flag is set the account may only sign in, read its session, change its password and sign
--    out; every other API answers 403 PASSWORD_CHANGE_REQUIRED (requireSession). A temporary
--    password past its expiry no longer signs in. Only the Argon2id hash is ever stored.
--
-- No row is deleted; `password_reset_codes` (the retired e-mail flow) is left in place, unused.

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
UPDATE "users" SET "email" = NULL WHERE "email" = '';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "temp_password_expires_at" TIMESTAMPTZ(6);

-- An e-mail, when present, is a real address in its stored (trimmed, lower-case) form: never ''.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_not_blank_check";
ALTER TABLE "users" ADD CONSTRAINT "users_email_not_blank_check"
  CHECK ("email" IS NULL OR length(btrim("email")) > 0);

-- A temporary password always has an expiry, and an expiry only exists with the flag.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_temp_password_check";
ALTER TABLE "users" ADD CONSTRAINT "users_temp_password_check"
  CHECK (("must_change_password" AND "temp_password_expires_at" IS NOT NULL)
      OR (NOT "must_change_password" AND "temp_password_expires_at" IS NULL));

-- The runtime roles can never SET the flag (only clear it, by changing the password): a bug or
-- an injected request in the app cannot put an account into, or keep it in, the reset state.
CREATE OR REPLACE FUNCTION hesba_users_temp_password_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('hesba_app', 'hesba_service') THEN
    IF TG_OP = 'INSERT' AND (NEW."must_change_password" OR NEW."temp_password_expires_at" IS NOT NULL) THEN
      RAISE EXCEPTION 'only the admin reset tool sets a temporary password'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."must_change_password" AND NOT OLD."must_change_password" THEN
      RAISE EXCEPTION 'only the admin reset tool sets a temporary password'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."temp_password_expires_at" IS DISTINCT FROM OLD."temp_password_expires_at"
       AND NEW."temp_password_expires_at" IS NOT NULL THEN
      RAISE EXCEPTION 'only the admin reset tool sets a temporary password'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "hesba_users_temp_password_guard" ON "users";
CREATE TRIGGER "hesba_users_temp_password_guard"
  BEFORE INSERT OR UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION hesba_users_temp_password_guard();
