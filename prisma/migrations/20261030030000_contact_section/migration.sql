-- Migration: 20261030030000_contact_section
-- Adds explicit section column to contacts with index for strict section separation

ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "section" TEXT NOT NULL DEFAULT 'owedToMe';

-- Backfill existing rows based on kind or debt entries if any
UPDATE "contacts" SET "section" = 'suppliers' WHERE "kind" = 'supplier';
UPDATE "contacts" SET "section" = 'iOwe' WHERE "kind" != 'supplier' AND "id" IN (
    SELECT "contact_id" FROM "debt_entries" WHERE "direction" = 'i_owe'
) AND "id" NOT IN (
    SELECT "contact_id" FROM "debt_entries" WHERE "direction" = 'owed_to_me'
);

CREATE INDEX IF NOT EXISTS "idx_contacts_store_section_deleted" ON "contacts" ("store_id", "section", "deleted_at");
