-- Simple-mode operations & financials: physical stocktaking, «فلوس حِسبة» money movements,
-- services with commissions, and credit / quantities on the daily sales total.
-- Every new table is a shop table: FORCE ROW LEVEL SECURITY + tenant_isolation, append-only
-- for the app (only the columns a status change needs are updatable), idempotent by op_id.
-- Nothing existing is dropped or rewritten; new columns are nullable or have defaults.

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 1. Stocktaking (الجرد) — named inventory_counts: an abandoned branch left stocktake_* tables in some databases
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inventory_counts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  -- Starting a stocktake is idempotent (a retried «اعمل جرد جديد» opens one session).
  "op_id" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "category" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "note" TEXT,
  "created_by" UUID,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Confirming is idempotent too: the same confirm_op_id applies the adjustments once.
  "confirm_op_id" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "abandoned_at" TIMESTAMPTZ(6),
  CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_counts_scope_check" CHECK ("scope" IN ('full', 'category', 'selected')),
  CONSTRAINT "inventory_counts_status_check" CHECK ("status" IN ('open', 'confirmed', 'abandoned')),
  CONSTRAINT "inventory_counts_state_check" CHECK (
    ("status" = 'open' AND "confirmed_at" IS NULL AND "abandoned_at" IS NULL)
    OR ("status" = 'confirmed' AND "confirmed_at" IS NOT NULL AND "confirm_op_id" IS NOT NULL)
    OR ("status" = 'abandoned' AND "abandoned_at" IS NOT NULL)),
  CONSTRAINT "inventory_counts_note_check" CHECK ("note" IS NULL OR length("note") <= 300),
  CONSTRAINT "inventory_counts_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_counts_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_counts_store_op" ON "inventory_counts" ("store_id", "op_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_counts_store_confirm_op"
  ON "inventory_counts" ("store_id", "confirm_op_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_counts_store_id" ON "inventory_counts" ("store_id", "id");
-- One stocktake in progress per shop: two open counts would fight over the same products.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_counts_one_open"
  ON "inventory_counts" ("store_id") WHERE "status" = 'open';
CREATE INDEX IF NOT EXISTS "idx_inventory_counts_store_started"
  ON "inventory_counts" ("store_id", "started_at" DESC);

CREATE TABLE IF NOT EXISTS "inventory_count_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "store_variant_id" UUID NOT NULL,
  -- What the system said when the line was counted (base units: pieces or grams).
  "expected_base" BIGINT NOT NULL,
  -- What the owner found on the shelves; NULL = not counted yet (left out at confirmation).
  "counted_base" BIGINT,
  -- The owner's explanation of a difference. A difference is NEVER a sale unless the owner
  -- says so ('unrecorded_sale'); an unexplained one stays 'unknown'.
  "reason" TEXT,
  -- Snapshots at count time, so the review and the history keep their values.
  "unit_cost_minor" BIGINT,
  "unit_price_minor" BIGINT NOT NULL DEFAULT 0,
  -- Filled at confirmation: the quantity really applied and its cost (FEFO batches / batch in).
  "applied_delta_base" BIGINT,
  "applied_cost_minor" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_count_lines_counted_check" CHECK ("counted_base" IS NULL OR "counted_base" >= 0),
  CONSTRAINT "inventory_count_lines_reason_check" CHECK (
    "reason" IS NULL OR "reason" IN ('unrecorded_sale', 'damaged', 'lost', 'unknown', 'surplus')),
  CONSTRAINT "inventory_count_lines_money_check" CHECK (
    ("unit_cost_minor" IS NULL OR "unit_cost_minor" >= 0) AND "unit_price_minor" >= 0),
  CONSTRAINT "inventory_count_lines_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_count_lines_session_fkey" FOREIGN KEY ("store_id", "session_id")
    REFERENCES "inventory_counts"("store_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_count_lines_store_variant_id_fkey" FOREIGN KEY ("store_variant_id")
    REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_inventory_count_lines_session_variant"
  ON "inventory_count_lines" ("session_id", "store_variant_id");
CREATE INDEX IF NOT EXISTS "idx_inventory_count_lines_store_session" ON "inventory_count_lines" ("store_id", "session_id");

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 2. «فلوس حِسبة»: owner withdrawals / deposits and internal transfers
-- (Machine FKs are NO ACTION, checked at the end of the statement: machines are only
-- soft-deleted by the app, and deleting a whole shop cascades both sides at once.)
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Sales, collections, expenses and supplier payments already move money in their own tables;
-- this table holds only the movements that are none of those. A transfer is never income or
-- an expense; an owner withdrawal is never an operating expense.
CREATE TABLE IF NOT EXISTS "money_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "op_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "amount_piasters" BIGINT NOT NULL,
  -- The money left the drawer (from_cash) or a machine / wallet (from_machine_id) …
  "from_cash" BOOLEAN NOT NULL DEFAULT false,
  "from_machine_id" UUID,
  -- … and went into the drawer (to_cash) or a machine / wallet (to_machine_id).
  "to_cash" BOOLEAN NOT NULL DEFAULT false,
  "to_machine_id" UUID,
  "note" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "money_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "money_movements_kind_check" CHECK ("kind" IN ('owner_withdrawal', 'owner_deposit', 'transfer')),
  CONSTRAINT "money_movements_amount_check" CHECK ("amount_piasters" > 0),
  CONSTRAINT "money_movements_note_check" CHECK ("note" IS NULL OR length("note") <= 300),
  -- At most one source and one destination, each either the drawer or a machine.
  CONSTRAINT "money_movements_from_check" CHECK (NOT ("from_cash" AND "from_machine_id" IS NOT NULL)),
  CONSTRAINT "money_movements_to_check" CHECK (NOT ("to_cash" AND "to_machine_id" IS NOT NULL)),
  CONSTRAINT "money_movements_shape_check" CHECK (
    ("kind" = 'owner_withdrawal'
       AND ("from_cash" OR "from_machine_id" IS NOT NULL)
       AND NOT "to_cash" AND "to_machine_id" IS NULL)
    OR ("kind" = 'owner_deposit'
       AND ("to_cash" OR "to_machine_id" IS NOT NULL)
       AND NOT "from_cash" AND "from_machine_id" IS NULL)
    OR ("kind" = 'transfer'
       AND ("from_cash" OR "from_machine_id" IS NOT NULL)
       AND ("to_cash" OR "to_machine_id" IS NOT NULL)
       AND NOT ("from_cash" AND "to_cash")
       AND "from_machine_id" IS DISTINCT FROM "to_machine_id")),
  CONSTRAINT "money_movements_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "money_movements_from_machine_fkey" FOREIGN KEY ("from_machine_id")
    REFERENCES "pos_machines"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "money_movements_to_machine_fkey" FOREIGN KEY ("to_machine_id")
    REFERENCES "pos_machines"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "money_movements_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_money_movements_store_op" ON "money_movements" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_money_movements_store_created"
  ON "money_movements" ("store_id", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 3. Services with commissions (both modes)
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A service the shop performed by hand on a provider's app or machine (no provider API: the
-- owner records it AFTER it went through; nothing here claims a provider confirmation).
-- direction 'send': the customer gives money and the shop sends it out of its float
--   (wallet deposit / transfer, bill, recharge, package, card).
-- direction 'receive': money comes into the shop's float and the shop pays the customer
--   (wallet withdrawal).
-- The commission is the shop's income; the operation's amount is never revenue.
CREATE TABLE IF NOT EXISTS "service_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "op_id" UUID NOT NULL,
  "service_key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "service_type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  -- The operation's value (what was sent / received through the provider).
  "amount_piasters" BIGINT NOT NULL,
  -- Snapshot of the shop's commission at that moment: later rule changes never rewrite it.
  "commission_piasters" BIGINT NOT NULL,
  -- 'customer_fee': the customer pays the commission on top (send) / it is kept from the payout
  -- (receive). 'provider_discount': the provider leaves it in the float.
  "commission_mode" TEXT NOT NULL,
  -- What the customer handed over (send) or was paid (receive).
  "customer_piasters" BIGINT NOT NULL,
  -- The change in the provider float (signed): send < 0, receive > 0.
  "float_delta_piasters" BIGINT NOT NULL,
  "float_machine_id" UUID NOT NULL,
  -- Where the customer's money went / came from: the drawer or a machine / wallet.
  "payment_cash" BOOLEAN NOT NULL DEFAULT true,
  "payment_machine_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "reference" TEXT,
  "note" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelled_at" TIMESTAMPTZ(6),
  CONSTRAINT "service_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_transactions_direction_check" CHECK ("direction" IN ('send', 'receive')),
  CONSTRAINT "service_transactions_mode_check" CHECK ("commission_mode" IN ('customer_fee', 'provider_discount')),
  CONSTRAINT "service_transactions_status_check" CHECK ("status" IN ('completed', 'cancelled')),
  CONSTRAINT "service_transactions_cancel_check" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL)),
  CONSTRAINT "service_transactions_amounts_check" CHECK (
    "amount_piasters" > 0 AND "commission_piasters" >= 0 AND "customer_piasters" >= 0),
  -- The books balance: what the customer side moved and what the float moved differ by
  -- exactly the commission (send: in − float out = commission; receive: float in − out).
  CONSTRAINT "service_transactions_balance_check" CHECK (
    ("direction" = 'send' AND "float_delta_piasters" <= 0
       AND "customer_piasters" + "float_delta_piasters" = "commission_piasters")
    OR ("direction" = 'receive' AND "float_delta_piasters" > 0
       AND "float_delta_piasters" - "customer_piasters" = "commission_piasters")),
  CONSTRAINT "service_transactions_payment_check" CHECK (
    ("payment_cash" AND "payment_machine_id" IS NULL)
    OR (NOT "payment_cash" AND "payment_machine_id" IS NOT NULL
        AND "payment_machine_id" <> "float_machine_id")),
  CONSTRAINT "service_transactions_text_check" CHECK (
    length("service_key") BETWEEN 1 AND 64 AND length("category") BETWEEN 1 AND 40
    AND length("provider") BETWEEN 1 AND 60 AND length("service_type") BETWEEN 1 AND 40
    AND ("reference" IS NULL OR length("reference") <= 100)
    AND ("note" IS NULL OR length("note") <= 300)),
  CONSTRAINT "service_transactions_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "service_transactions_float_machine_fkey" FOREIGN KEY ("float_machine_id")
    REFERENCES "pos_machines"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "service_transactions_payment_machine_fkey" FOREIGN KEY ("payment_machine_id")
    REFERENCES "pos_machines"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "service_transactions_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_transactions_store_op" ON "service_transactions" ("store_id", "op_id");
CREATE INDEX IF NOT EXISTS "idx_service_transactions_store_created"
  ON "service_transactions" ("store_id", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 4. The daily sales total: a credit part and optional quantities
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- The part sold on credit (آجل) to named customers: revenue, a receivable, never cash.
ALTER TABLE "daily_sales_entries" ADD COLUMN IF NOT EXISTS "credit_piasters" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "daily_sales_entries" DROP CONSTRAINT IF EXISTS "daily_sales_entries_credit_check";
ALTER TABLE "daily_sales_entries" ADD CONSTRAINT "daily_sales_entries_credit_check"
  CHECK ("credit_piasters" >= 0 AND "cash_piasters" + "credit_piasters" <= "total_piasters");

-- A customer debt created by a daily total's credit part (so a cancel reverses exactly it).
ALTER TABLE "debt_entries" ADD COLUMN IF NOT EXISTS "daily_sales_entry_id" UUID;
ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "debt_entries_daily_sales_entry_fkey";
ALTER TABLE "debt_entries" ADD CONSTRAINT "debt_entries_daily_sales_entry_fkey"
  FOREIGN KEY ("daily_sales_entry_id") REFERENCES "daily_sales_entries"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_debt_entries_daily_sales_entry"
  ON "debt_entries" ("daily_sales_entry_id");

-- Optional quantities sold, recorded with a daily total: they take stock out (FEFO, with its
-- cost) but add NO revenue — the money is already in the total.
CREATE TABLE IF NOT EXISTS "daily_sales_entry_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "entry_id" UUID NOT NULL,
  "store_variant_id" UUID NOT NULL,
  "quantity_base" BIGINT NOT NULL,
  -- The cost of the stock really taken (FEFO batches); NULL when a batch had no cost.
  "cost_minor" BIGINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_sales_entry_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_sales_entry_items_qty_check" CHECK ("quantity_base" > 0),
  CONSTRAINT "daily_sales_entry_items_store_id_fkey" FOREIGN KEY ("store_id")
    REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_sales_entry_items_entry_id_fkey" FOREIGN KEY ("entry_id")
    REFERENCES "daily_sales_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_sales_entry_items_variant_fkey" FOREIGN KEY ("store_variant_id")
    REFERENCES "store_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_daily_sales_entry_items_entry_variant"
  ON "daily_sales_entry_items" ("entry_id", "store_variant_id");
CREATE INDEX IF NOT EXISTS "idx_daily_sales_entry_items_store" ON "daily_sales_entry_items" ("store_id", "created_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 5. Row level security and grants
-- ─────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_counts', 'inventory_count_lines', 'money_movements',
                           'service_transactions', 'daily_sales_entry_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "tenant_isolation" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "tenant_isolation" ON %I
         USING (store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)
         WITH CHECK (store_id = NULLIF(current_setting(''app.store_id'', true), '''')::uuid)', t);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hesba_app') THEN
    -- Sessions: only the status columns change; the history is kept.
    GRANT SELECT, INSERT ON "inventory_counts" TO hesba_app;
    REVOKE UPDATE, DELETE ON "inventory_counts" FROM hesba_app;
    GRANT UPDATE ("status", "confirm_op_id", "confirmed_at", "abandoned_at") ON "inventory_counts" TO hesba_app;
    -- Lines: counted / explained while the session is open, then frozen (trigger below).
    GRANT SELECT, INSERT, DELETE ON "inventory_count_lines" TO hesba_app;
    REVOKE UPDATE ON "inventory_count_lines" FROM hesba_app;
    -- expected_base is the count-time snapshot: refreshed when a line is (re)counted.
    GRANT UPDATE ("expected_base", "counted_base", "reason", "applied_delta_base", "applied_cost_minor", "updated_at")
      ON "inventory_count_lines" TO hesba_app;
    -- Money movements: append-only (a mistake is corrected by the opposite movement).
    GRANT SELECT, INSERT ON "money_movements" TO hesba_app;
    REVOKE UPDATE, DELETE ON "money_movements" FROM hesba_app;
    -- Services: append-only except the cancel mark.
    GRANT SELECT, INSERT ON "service_transactions" TO hesba_app;
    REVOKE UPDATE, DELETE ON "service_transactions" FROM hesba_app;
    GRANT UPDATE ("status", "cancelled_at") ON "service_transactions" TO hesba_app;
    GRANT SELECT, INSERT ON "daily_sales_entry_items" TO hesba_app;
    REVOKE UPDATE, DELETE ON "daily_sales_entry_items" FROM hesba_app;
  END IF;
END $$;

-- A confirmed or abandoned stocktake is history: its lines can no longer change or vanish.
CREATE OR REPLACE FUNCTION hesba_inventory_count_lines_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s TEXT;
BEGIN
  SELECT status INTO s FROM inventory_counts
   WHERE id = COALESCE(NEW.session_id, OLD.session_id);
  -- Confirmation itself writes applied_* while the session is still 'open' (same transaction,
  -- before the status flips), so only lines of a closed session are frozen.
  IF s IS NOT NULL AND s <> 'open' THEN
    RAISE EXCEPTION 'inventory count % is closed', COALESCE(NEW.session_id, OLD.session_id)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS "hesba_inventory_count_lines_frozen" ON "inventory_count_lines";
CREATE TRIGGER "hesba_inventory_count_lines_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "inventory_count_lines"
  FOR EACH ROW EXECUTE FUNCTION hesba_inventory_count_lines_frozen();

-- A closed session never reopens, and a confirmed one never becomes abandoned.
CREATE OR REPLACE FUNCTION hesba_inventory_counts_closed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'open' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'inventory count % is already %', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "hesba_inventory_counts_closed" ON "inventory_counts";
CREATE TRIGGER "hesba_inventory_counts_closed"
  BEFORE UPDATE ON "inventory_counts"
  FOR EACH ROW EXECUTE FUNCTION hesba_inventory_counts_closed();
