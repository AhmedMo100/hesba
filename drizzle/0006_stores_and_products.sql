ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "name_ar" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "owner_name" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "city" text;--> statement-breakpoint
CREATE TABLE "store_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"global_product_id" uuid,
	"name_ar" text,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"sell_price_piasters" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_products_name_or_global_check" CHECK (global_product_id IS NOT NULL OR (name_ar IS NOT NULL AND name_ar <> '')),
	CONSTRAINT "store_products_unit_check" CHECK (unit IN ('g', 'kg', 'ml', 'l', 'piece'))
);
--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_global_product_id_global_products_id_fk" FOREIGN KEY ("global_product_id") REFERENCES "public"."global_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_variants" ADD COLUMN IF NOT EXISTS "store_product_id" uuid;--> statement-breakpoint
ALTER TABLE "store_variants" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_store_product_id_store_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_products"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_products" TO hesba_app;
