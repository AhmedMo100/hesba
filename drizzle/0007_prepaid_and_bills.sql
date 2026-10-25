CREATE TYPE "public"."bill_type" AS ENUM('internet', 'mobile', 'landline', 'electricity', 'gas', 'water', 'other');--> statement-breakpoint
CREATE TABLE "prepaid_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" text NOT NULL,
	"denomination_piasters" bigint NOT NULL,
	"data_package_ar" text,
	"validity_days" integer,
	"cost_piasters" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_prepaid_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"prepaid_product_id" uuid NOT NULL,
	"sell_price_piasters" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"bill_type" "bill_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"bill_provider_id" uuid NOT NULL,
	"customer_reference" text,
	"amount_piasters" bigint NOT NULL,
	"fee_piasters" bigint NOT NULL,
	"op_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_prepaid_prices" ADD CONSTRAINT "store_prepaid_prices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_prepaid_prices" ADD CONSTRAINT "store_prepaid_prices_prepaid_product_id_prepaid_products_id_fk" FOREIGN KEY ("prepaid_product_id") REFERENCES "public"."prepaid_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_prepaid_prices_store_product_unique" ON "store_prepaid_prices" ("store_id", "prepaid_product_id");--> statement-breakpoint
ALTER TABLE "card_serials" ADD COLUMN IF NOT EXISTS "prepaid_product_id" uuid;--> statement-breakpoint
ALTER TABLE "card_serials" ADD CONSTRAINT "card_serials_prepaid_product_id_prepaid_products_id_fk" FOREIGN KEY ("prepaid_product_id") REFERENCES "public"."prepaid_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_bill_payments" ADD CONSTRAINT "store_bill_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_bill_payments" ADD CONSTRAINT "store_bill_payments_bill_provider_id_bill_providers_id_fk" FOREIGN KEY ("bill_provider_id") REFERENCES "public"."bill_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_bill_payments_store_op_unique" ON "store_bill_payments" ("store_id", "op_id");--> statement-breakpoint
ALTER TABLE "prepaid_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prepaid_products" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prepaid_products_read_all" ON "prepaid_products" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "prepaid_products_migrator_all" ON "prepaid_products" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "prepaid_products" FROM hesba_app;--> statement-breakpoint
GRANT SELECT ON "prepaid_products" TO hesba_app;--> statement-breakpoint
ALTER TABLE "store_prepaid_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_prepaid_prices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_prepaid_prices"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_prepaid_prices" TO hesba_app;--> statement-breakpoint
ALTER TABLE "bill_providers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_providers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "bill_providers_read_all" ON "bill_providers" AS PERMISSIVE FOR SELECT TO public USING (true);--> statement-breakpoint
CREATE POLICY "bill_providers_migrator_all" ON "bill_providers" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "bill_providers" FROM hesba_app;--> statement-breakpoint
GRANT SELECT ON "bill_providers" TO hesba_app;--> statement-breakpoint
ALTER TABLE "store_bill_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_bill_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_bill_payments"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "store_bill_payments" TO hesba_app;
