CREATE TYPE "public"."sale_payment_method" AS ENUM('cash', 'wallet', 'card', 'debt');--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"supplier_contact_id" uuid,
	"total_piasters" bigint NOT NULL,
	"op_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"store_product_id" uuid,
	"store_variant_id" uuid,
	"quantity_base_units" bigint NOT NULL,
	"unit_cost_piasters" bigint NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_lines_product_or_variant_check" CHECK (store_product_id IS NOT NULL OR store_variant_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"total_piasters" bigint NOT NULL,
	"payment_method" "sale_payment_method" NOT NULL,
	"customer_contact_id" uuid,
	"op_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_contact_id_contacts_id_fk" FOREIGN KEY ("supplier_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_store_op_unique" ON "purchases" ("store_id", "op_id");--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_product_id_store_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_variant_id_store_variants_id_fk" FOREIGN KEY ("store_variant_id") REFERENCES "public"."store_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_contact_id_contacts_id_fk" FOREIGN KEY ("customer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_store_op_unique" ON "sales" ("store_id", "op_id");--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "store_product_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "store_bill_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_product_id_store_products_id_fk" FOREIGN KEY ("store_product_id") REFERENCES "public"."store_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_bill_payment_id_store_bill_payments_id_fk" FOREIGN KEY ("store_bill_payment_id") REFERENCES "public"."store_bill_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_exactly_one_item_check" CHECK (
  ((CASE WHEN store_product_id IS NOT NULL THEN 1 ELSE 0 END) +
   (CASE WHEN store_variant_id IS NOT NULL THEN 1 ELSE 0 END) +
   (CASE WHEN card_serial_id IS NOT NULL THEN 1 ELSE 0 END) +
   (CASE WHEN store_bill_payment_id IS NOT NULL THEN 1 ELSE 0 END)) = 1
);--> statement-breakpoint
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchases"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
REVOKE UPDATE, DELETE ON "purchases" FROM hesba_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "purchases" TO hesba_app;--> statement-breakpoint
ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchase_lines"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchase_lines" TO hesba_app;--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
REVOKE UPDATE, DELETE ON "sales" FROM hesba_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "sales" TO hesba_app;
