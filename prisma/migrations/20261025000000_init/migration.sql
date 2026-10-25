-- CreateEnum
CREATE TYPE "store_member_role" AS ENUM ('owner', 'manager', 'cashier');

-- CreateEnum
CREATE TYPE "global_product_type" AS ENUM ('stock', 'prepaid', 'service');

-- CreateEnum
CREATE TYPE "card_serial_status" AS ENUM ('available', 'sold', 'void');

-- CreateEnum
CREATE TYPE "commission_fee_type" AS ENUM ('fixed', 'percent');

-- CreateEnum
CREATE TYPE "bill_type" AS ENUM ('internet', 'mobile', 'landline', 'electricity', 'gas', 'water', 'other');

-- CreateEnum
CREATE TYPE "wallet_provider" AS ENUM ('vodafone_cash', 'instapay', 'other');

-- CreateEnum
CREATE TYPE "wallet_transaction_kind" AS ENUM ('transfer_in', 'transfer_out', 'withdrawal', 'owner_deposit', 'reversal');

-- CreateEnum
CREATE TYPE "contact_kind" AS ENUM ('customer', 'supplier', 'both');

-- CreateEnum
CREATE TYPE "debt_direction" AS ENUM ('owed_to_me', 'i_owe');

-- CreateEnum
CREATE TYPE "sale_payment_method" AS ENUM ('cash', 'wallet', 'card', 'debt');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "ai_message_role" AS ENUM ('user', 'assistant');

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "name_ar" TEXT DEFAULT '',
    "owner_name" TEXT,
    "city" TEXT,
    "shop_type" TEXT NOT NULL,
    "governorate" TEXT NOT NULL,
    "area" TEXT,
    "opened_on" DATE,
    "workers_count" INTEGER,
    "share_custom_products" BOOLEAN NOT NULL DEFAULT true,
    "receive_suggestions" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_members" (
    "store_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "store_member_role" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_members_pkey" PRIMARY KEY ("store_id","user_id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "app_version" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "brand_id" UUID,
    "name_ar" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" "global_product_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "global_product_id" UUID NOT NULL,
    "flavor" TEXT,
    "size_value" DECIMAL,
    "size_unit" TEXT,
    "pack_qty" INTEGER NOT NULL DEFAULT 1,
    "barcode" TEXT,
    "name_norm" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "global_product_id" UUID,
    "name_ar" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "sell_price_piasters" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_variants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "store_product_id" UUID,
    "product_id" UUID,
    "global_variant_id" UUID,
    "flavor" TEXT,
    "size_value" DECIMAL,
    "size_unit" TEXT,
    "pack_qty" INTEGER NOT NULL DEFAULT 1,
    "barcode" TEXT,
    "sell_price_piasters" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prepaid_products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "network" TEXT NOT NULL,
    "denomination_piasters" BIGINT NOT NULL,
    "data_package_ar" TEXT,
    "validity_days" INTEGER,
    "cost_piasters" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prepaid_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_prepaid_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "prepaid_product_id" UUID NOT NULL,
    "sell_price_piasters" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_prepaid_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_serials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "service_item_id" UUID,
    "prepaid_product_id" UUID,
    "card_number_encrypted" TEXT NOT NULL,
    "pin_encrypted" TEXT NOT NULL,
    "status" "card_serial_status" NOT NULL DEFAULT 'available',
    "sold_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_serials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_amount_piasters" BIGINT NOT NULL,
    "to_amount_piasters" BIGINT NOT NULL,
    "fee_type" "commission_fee_type" NOT NULL,
    "fee_value" DECIMAL NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name_ar" TEXT NOT NULL,
    "bill_type" "bill_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_bill_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "bill_provider_id" UUID NOT NULL,
    "customer_reference" TEXT,
    "amount_piasters" BIGINT NOT NULL,
    "fee_piasters" BIGINT NOT NULL DEFAULT 0,
    "op_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "provider" "wallet_provider" NOT NULL,
    "label_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "kind" "wallet_transaction_kind" NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    "fee_piasters" BIGINT NOT NULL DEFAULT 0,
    "balance_after_piasters" BIGINT NOT NULL,
    "commission_rule_id" UUID,
    "op_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "kind" "contact_kind" NOT NULL,
    "name_ar" TEXT NOT NULL,
    "phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "direction" "debt_direction" NOT NULL,
    "amount_piasters" BIGINT NOT NULL,
    "note_ar" TEXT,
    "settles_entry_id" UUID,
    "op_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "supplier_contact_id" UUID,
    "total_piasters" BIGINT NOT NULL,
    "op_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "store_product_id" UUID,
    "store_variant_id" UUID,
    "quantity_base_units" INTEGER NOT NULL,
    "unit_cost_piasters" BIGINT NOT NULL,
    "expires_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "customer_contact_id" UUID,
    "payment_method" "sale_payment_method" NOT NULL,
    "total_piasters" BIGINT NOT NULL,
    "op_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "sale_id" UUID,
    "store_product_id" UUID,
    "store_variant_id" UUID,
    "card_serial_id" UUID,
    "store_bill_payment_id" UUID,
    "quantity_base_units" INTEGER NOT NULL,
    "unit_price_piasters" BIGINT NOT NULL,
    "total_piasters" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "message_ar" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "role" "ai_message_role" NOT NULL,
    "body_text" TEXT NOT NULL,
    "conversation_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "store_prepaid_prices_store_id_prepaid_product_id_key" ON "store_prepaid_prices"("store_id", "prepaid_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_bill_payments_store_id_op_id_key" ON "store_bill_payments"("store_id", "op_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_store_id_op_id_key" ON "wallet_transactions"("store_id", "op_id");

-- CreateIndex
CREATE UNIQUE INDEX "debt_entries_store_id_op_id_key" ON "debt_entries"("store_id", "op_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_store_id_op_id_key" ON "purchases"("store_id", "op_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_store_id_op_id_key" ON "sales"("store_id", "op_id");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_products" ADD CONSTRAINT "global_products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "global_variants" ADD CONSTRAINT "global_variants_global_product_id_fkey" FOREIGN KEY ("global_product_id") REFERENCES "global_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_products" ADD CONSTRAINT "store_products_global_product_id_fkey" FOREIGN KEY ("global_product_id") REFERENCES "global_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_store_product_id_fkey" FOREIGN KEY ("store_product_id") REFERENCES "store_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "global_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_variants" ADD CONSTRAINT "store_variants_global_variant_id_fkey" FOREIGN KEY ("global_variant_id") REFERENCES "global_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_prepaid_prices" ADD CONSTRAINT "store_prepaid_prices_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_prepaid_prices" ADD CONSTRAINT "store_prepaid_prices_prepaid_product_id_fkey" FOREIGN KEY ("prepaid_product_id") REFERENCES "prepaid_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_items" ADD CONSTRAINT "service_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_serials" ADD CONSTRAINT "card_serials_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_serials" ADD CONSTRAINT "card_serials_service_item_id_fkey" FOREIGN KEY ("service_item_id") REFERENCES "service_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_serials" ADD CONSTRAINT "card_serials_prepaid_product_id_fkey" FOREIGN KEY ("prepaid_product_id") REFERENCES "prepaid_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_bill_payments" ADD CONSTRAINT "store_bill_payments_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_bill_payments" ADD CONSTRAINT "store_bill_payments_bill_provider_id_fkey" FOREIGN KEY ("bill_provider_id") REFERENCES "bill_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_settles_entry_id_fkey" FOREIGN KEY ("settles_entry_id") REFERENCES "debt_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_contact_id_fkey" FOREIGN KEY ("supplier_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_product_id_fkey" FOREIGN KEY ("store_product_id") REFERENCES "store_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "store_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_contact_id_fkey" FOREIGN KEY ("customer_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_product_id_fkey" FOREIGN KEY ("store_product_id") REFERENCES "store_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_variant_id_fkey" FOREIGN KEY ("store_variant_id") REFERENCES "store_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_card_serial_id_fkey" FOREIGN KEY ("card_serial_id") REFERENCES "card_serials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_store_bill_payment_id_fkey" FOREIGN KEY ("store_bill_payment_id") REFERENCES "store_bill_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Custom PostgreSQL Extensions, Trigram Indexes, Partial Indexes, Checks, RLS & Grants
-- ============================================================================

-- 1. Trigram Extension & GIN Trigram Index
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "idx_global_variants_name_trgm" ON "global_variants" USING gin ("name_norm" gin_trgm_ops);

-- 2. Partial Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_global_variants_barcode" ON "global_variants" ("barcode") WHERE "barcode" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_store_variants_store_barcode" ON "store_variants" ("store_id", "barcode") WHERE "barcode" IS NOT NULL;

-- 3. Check Constraints
ALTER TABLE "store_products" ADD CONSTRAINT "chk_store_products_identity" CHECK ("global_product_id" IS NOT NULL OR ("name_ar" IS NOT NULL AND btrim("name_ar") != ''));
ALTER TABLE "store_products" ADD CONSTRAINT "chk_store_products_unit" CHECK ("unit" IN ('g', 'kg', 'ml', 'l', 'piece'));
ALTER TABLE "purchase_lines" ADD CONSTRAINT "chk_purchase_lines_target" CHECK ("store_product_id" IS NOT NULL OR "store_variant_id" IS NOT NULL);
ALTER TABLE "sale_lines" ADD CONSTRAINT "chk_sale_lines_exactly_one_target" CHECK (((CASE WHEN "store_product_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "store_variant_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "card_serial_id" IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN "store_bill_payment_id" IS NOT NULL THEN 1 ELSE 0 END)) = 1);

-- 4. Enable and Force Row Level Security
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;

ALTER TABLE "store_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_members" FORCE ROW LEVEL SECURITY;

ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "devices" FORCE ROW LEVEL SECURITY;

ALTER TABLE "store_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_products" FORCE ROW LEVEL SECURITY;

ALTER TABLE "store_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_variants" FORCE ROW LEVEL SECURITY;

ALTER TABLE "store_prepaid_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_prepaid_prices" FORCE ROW LEVEL SECURITY;

ALTER TABLE "card_serials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_serials" FORCE ROW LEVEL SECURITY;

ALTER TABLE "store_bill_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_bill_payments" FORCE ROW LEVEL SECURITY;

ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallets" FORCE ROW LEVEL SECURITY;

ALTER TABLE "wallet_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_transactions" FORCE ROW LEVEL SECURITY;

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;

ALTER TABLE "debt_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "debt_entries" FORCE ROW LEVEL SECURITY;

ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;

ALTER TABLE "purchase_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_lines" FORCE ROW LEVEL SECURITY;

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;

ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_lines" FORCE ROW LEVEL SECURITY;

ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alerts" FORCE ROW LEVEL SECURITY;

ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;

ALTER TABLE "service_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_items" FORCE ROW LEVEL SECURITY;

-- Global catalog tables
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brands" FORCE ROW LEVEL SECURITY;

ALTER TABLE "global_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "global_products" FORCE ROW LEVEL SECURITY;

ALTER TABLE "global_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "global_variants" FORCE ROW LEVEL SECURITY;

ALTER TABLE "prepaid_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prepaid_products" FORCE ROW LEVEL SECURITY;

ALTER TABLE "bill_providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bill_providers" FORCE ROW LEVEL SECURITY;

ALTER TABLE "commission_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_rules" FORCE ROW LEVEL SECURITY;

-- 5. Row Level Security Policies
CREATE POLICY tenant_isolation ON "stores" FOR ALL
  USING ("id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "store_members" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "devices" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "store_products" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "store_variants" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "store_prepaid_prices" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "card_serials" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "store_bill_payments" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "wallets" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "wallet_transactions" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "contacts" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "debt_entries" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "purchases" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "purchase_lines" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "sales" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "sale_lines" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "alerts" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "ai_messages" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

CREATE POLICY tenant_isolation ON "service_items" FOR ALL
  USING ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK ("store_id" = NULLIF(current_setting('app.store_id', true), '')::uuid);

-- Global catalog read-all policies
CREATE POLICY "brands_read_all" ON "brands" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "brands_migrator_all" ON "brands" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

CREATE POLICY "global_products_read_all" ON "global_products" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "global_products_migrator_all" ON "global_products" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

CREATE POLICY "global_variants_read_all" ON "global_variants" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "global_variants_migrator_all" ON "global_variants" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

CREATE POLICY "prepaid_products_read_all" ON "prepaid_products" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "prepaid_products_migrator_all" ON "prepaid_products" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

CREATE POLICY "bill_providers_read_all" ON "bill_providers" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "bill_providers_migrator_all" ON "bill_providers" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

CREATE POLICY "commission_rules_read_all" ON "commission_rules" AS PERMISSIVE FOR SELECT TO public USING (true);
CREATE POLICY "commission_rules_migrator_all" ON "commission_rules" AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- 6. Role Grants and Permissions
GRANT USAGE ON SCHEMA public TO hesba_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hesba_app;

-- Revoke write on global catalog tables
REVOKE INSERT, UPDATE, DELETE ON "brands" FROM hesba_app;
REVOKE INSERT, UPDATE, DELETE ON "global_products" FROM hesba_app;
REVOKE INSERT, UPDATE, DELETE ON "global_variants" FROM hesba_app;
REVOKE INSERT, UPDATE, DELETE ON "prepaid_products" FROM hesba_app;
REVOKE INSERT, UPDATE, DELETE ON "bill_providers" FROM hesba_app;
REVOKE INSERT, UPDATE, DELETE ON "commission_rules" FROM hesba_app;

-- Append-only tables: hesba_app gets only INSERT and SELECT
REVOKE UPDATE, DELETE ON "wallet_transactions" FROM hesba_app;
REVOKE UPDATE, DELETE ON "debt_entries" FROM hesba_app;
REVOKE UPDATE, DELETE ON "purchases" FROM hesba_app;
REVOKE UPDATE, DELETE ON "sales" FROM hesba_app;
