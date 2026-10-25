CREATE TYPE "public"."contact_kind" AS ENUM('customer', 'supplier', 'both');--> statement-breakpoint
CREATE TYPE "public"."debt_direction" AS ENUM('owed_to_me', 'i_owe');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"name_ar" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debt_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"direction" "debt_direction" NOT NULL,
	"amount_piasters" bigint NOT NULL,
	"note_ar" text,
	"settles_entry_id" uuid,
	"op_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_settles_entry_id_debt_entries_id_fk" FOREIGN KEY ("settles_entry_id") REFERENCES "public"."debt_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "debt_entries_store_op_unique" ON "debt_entries" ("store_id", "op_id");--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "contacts" TO hesba_app;--> statement-breakpoint
ALTER TABLE "debt_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debt_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "debt_entries"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
REVOKE UPDATE, DELETE ON "debt_entries" FROM hesba_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "debt_entries" TO hesba_app;
