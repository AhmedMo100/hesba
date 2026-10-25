CREATE TYPE "public"."wallet_provider" AS ENUM('vodafone_cash', 'instapay', 'other');--> statement-breakpoint
CREATE TYPE "public"."wallet_transaction_kind" AS ENUM('transfer_in', 'transfer_out', 'withdrawal', 'owner_deposit', 'reversal');--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" "wallet_provider" NOT NULL,
	"label_ar" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"kind" "wallet_transaction_kind" NOT NULL,
	"amount_piasters" bigint NOT NULL,
	"fee_piasters" bigint NOT NULL,
	"balance_after_piasters" bigint NOT NULL,
	"commission_rule_id" uuid,
	"op_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_commission_rule_id_commission_rules_id_fk" FOREIGN KEY ("commission_rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_store_op_unique" ON "wallet_transactions" ("store_id", "op_id");--> statement-breakpoint
ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wallets"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "wallets" TO hesba_app;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wallet_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "wallet_transactions"
  AS PERMISSIVE FOR ALL
  TO public
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);--> statement-breakpoint
REVOKE UPDATE, DELETE ON "wallet_transactions" FROM hesba_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "wallet_transactions" TO hesba_app;
