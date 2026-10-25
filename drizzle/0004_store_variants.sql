CREATE TABLE "store_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"global_variant_id" uuid,
	"flavor" text,
	"size_value" numeric,
	"size_unit" text,
	"pack_qty" integer DEFAULT 1 NOT NULL,
	"barcode" text,
	"sell_price_piasters" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_product_id_global_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."global_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_global_variant_id_global_variants_id_fk" FOREIGN KEY ("global_variant_id") REFERENCES "public"."global_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_variants_store_barcode_unique" ON "store_variants" ("store_id", "barcode") WHERE "barcode" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "store_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_variants"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_variants" TO hesba_app;
