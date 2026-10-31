-- CreatePolicy: Allow users to view their own store memberships when app.user_id is set
CREATE POLICY user_member_access ON "store_members" FOR SELECT
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- CreatePolicy: Allow users to view stores they are members of when app.user_id is set
CREATE POLICY user_store_access ON "stores" FOR SELECT
  USING (
    "id" IN (
      SELECT "store_id" FROM "store_members"
      WHERE "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
