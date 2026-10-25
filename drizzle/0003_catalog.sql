CREATE EXTENSION IF NOT EXISTS "pg_trgm";--> statement-breakpoint
CREATE TYPE "public"."product_type" AS ENUM('stock', 'prepaid', 'service');--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_ar_unique" UNIQUE("name_ar")
);
--> statement-breakpoint
CREATE TABLE "global_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"name" text NOT NULL,
	"name_norm" text NOT NULL,
	"category" text NOT NULL,
	"type" "product_type" DEFAULT 'stock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"flavor" text,
	"size_value" numeric,
	"size_unit" text,
	"pack_qty" integer DEFAULT 1 NOT NULL,
	"barcode" text,
	"name_norm" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "global_products" ADD CONSTRAINT "global_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_variants" ADD CONSTRAINT "global_variants_product_id_global_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."global_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "global_products_name_norm_trgm_idx" ON "global_products" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "global_variants_name_norm_trgm_idx" ON "global_variants" USING gin ("name_norm" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "global_variants_barcode_unique" ON "global_variants" ("barcode") WHERE "barcode" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "brands_read_all" ON "brands" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "brands_migrator_all" ON "brands" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "global_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "global_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "global_products_read_all" ON "global_products" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "global_products_migrator_all" ON "global_products" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE "global_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "global_variants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "global_variants_read_all" ON "global_variants" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "global_variants_migrator_all" ON "global_variants" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "brands", "global_products", "global_variants" FROM hesba_app;--> statement-breakpoint
GRANT SELECT ON "brands", "global_products", "global_variants" TO hesba_app;
