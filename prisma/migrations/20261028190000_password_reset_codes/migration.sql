-- CreateTable
CREATE TABLE "password_reset_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_codes_user_id_code_hash_idx" ON "password_reset_codes"("user_id", "code_hash");

-- CreateIndex
CREATE INDEX "password_reset_codes_expires_at_idx" ON "password_reset_codes"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grant permissions to hesba_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "password_reset_codes" TO hesba_app;
