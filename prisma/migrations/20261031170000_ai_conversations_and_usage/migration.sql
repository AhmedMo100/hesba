-- Migration: 20261031170000_ai_conversations_and_usage
-- AI conversations, daily quota usage, message enhancements, RLS policies, and permissions

-- 1. AI Conversations Table (one daily conversation per store per day)
CREATE TABLE IF NOT EXISTS "ai_conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_conversations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "uq_ai_conversations_store_day" UNIQUE ("store_id", "day")
);

CREATE INDEX IF NOT EXISTS "idx_ai_conversations_store_day" ON "ai_conversations" ("store_id", "day" DESC);

-- RLS on ai_conversations
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "ai_conversations";
CREATE POLICY "tenant_isolation" ON "ai_conversations"
    USING (
      store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
      OR current_setting('app.is_maintenance', true) = 'true'
    )
    WITH CHECK (
      store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
      OR current_setting('app.is_maintenance', true) = 'true'
    );

DROP POLICY IF EXISTS "ai_conversations_migrator_all" ON "ai_conversations";
CREATE POLICY "ai_conversations_migrator_all" ON "ai_conversations"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_conversations" TO hesba_app;

-- 2. AI Usage Table (atomic daily quota enforcement)
CREATE TABLE IF NOT EXISTS "ai_usage" (
    "store_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("store_id", "day"),
    CONSTRAINT "ai_usage_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RLS on ai_usage
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "ai_usage";
CREATE POLICY "tenant_isolation" ON "ai_usage"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "ai_usage_migrator_all" ON "ai_usage";
CREATE POLICY "ai_usage_migrator_all" ON "ai_usage"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_usage" TO hesba_app;

-- 3. AI Messages Enhancements
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "sources" JSONB;
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "client_message_id" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ai_messages_conversation_id_fkey'
    ) THEN
        ALTER TABLE "ai_messages" 
        ADD CONSTRAINT "ai_messages_conversation_id_fkey" 
        FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_ai_messages_store_conv_created" ON "ai_messages" ("store_id", "conversation_id", "created_at" ASC);
CREATE INDEX IF NOT EXISTS "idx_ai_messages_store_client_id" ON "ai_messages" ("store_id", "client_message_id");

DROP POLICY IF EXISTS "ai_messages_migrator_all" ON "ai_messages";
CREATE POLICY "ai_messages_migrator_all" ON "ai_messages"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_messages" TO hesba_app;
