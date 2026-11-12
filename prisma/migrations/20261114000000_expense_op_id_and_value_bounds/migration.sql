-- QA-27 + QA-15 (ADR-0025).
--
-- 1. Expenses get the client's operation id: the same op_id is recorded at most once per store
--    (the unique index decides between concurrent retries). Nullable: older clients that send
--    no op_id keep working. Existing rows are not changed.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "op_id" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_expenses_store_op" ON "expenses" ("store_id", "op_id");

-- 2. Upper bounds on money and quantities (QA-15), mirroring src/domain/limits.ts:
--    one money amount ≤ 1,000,000,000 piasters (10,000,000 EGP); one operation's quantity
--    ≤ 1,000,000 base units. The API rejects bigger values first with a clear 400; these are
--    the last line of defence. NOT VALID: they apply to new and changed rows only, so existing
--    (historical) data is not rewritten or rejected — values written before the bounds existed
--    stay as they are and need a data review (ADR-0025).
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "chk_expenses_amount_bounds";
ALTER TABLE "expenses" ADD CONSTRAINT "chk_expenses_amount_bounds"
  CHECK ("amount_piasters" > 0 AND "amount_piasters" <= 1000000000) NOT VALID;

ALTER TABLE "debt_entries" DROP CONSTRAINT IF EXISTS "chk_debt_entries_amount_max";
ALTER TABLE "debt_entries" ADD CONSTRAINT "chk_debt_entries_amount_max"
  CHECK ("amount_piasters" <= 1000000000) NOT VALID;

ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "chk_sales_total_bounds";
ALTER TABLE "sales" ADD CONSTRAINT "chk_sales_total_bounds"
  CHECK ("total_piasters" >= 0 AND "total_piasters" <= 1000000000) NOT VALID;

ALTER TABLE "sale_lines" DROP CONSTRAINT IF EXISTS "chk_sale_lines_bounds";
ALTER TABLE "sale_lines" ADD CONSTRAINT "chk_sale_lines_bounds"
  CHECK (
    "quantity_base_units" > 0 AND "quantity_base_units" <= 1000000
    AND "unit_price_piasters" >= 0 AND "unit_price_piasters" <= 1000000000
    AND "total_piasters" >= 0 AND "total_piasters" <= 1000000000
  ) NOT VALID;

ALTER TABLE "store_products" DROP CONSTRAINT IF EXISTS "chk_store_products_price_bounds";
ALTER TABLE "store_products" ADD CONSTRAINT "chk_store_products_price_bounds"
  CHECK (
    "sell_price_piasters" >= 0 AND "sell_price_piasters" <= 1000000000
    AND ("buy_price_piasters" IS NULL OR ("buy_price_piasters" >= 0 AND "buy_price_piasters" <= 1000000000))
  ) NOT VALID;

ALTER TABLE "store_variants" DROP CONSTRAINT IF EXISTS "chk_store_variants_price_bounds";
ALTER TABLE "store_variants" ADD CONSTRAINT "chk_store_variants_price_bounds"
  CHECK (
    "sell_price_piasters" >= 0 AND "sell_price_piasters" <= 1000000000
    AND ("buy_price_piasters" IS NULL OR ("buy_price_piasters" >= 0 AND "buy_price_piasters" <= 1000000000))
  ) NOT VALID;

ALTER TABLE "store_stock_batches" DROP CONSTRAINT IF EXISTS "chk_store_stock_batches_qty_bounds";
ALTER TABLE "store_stock_batches" ADD CONSTRAINT "chk_store_stock_batches_qty_bounds"
  CHECK (
    "received_quantity_base" > 0 AND "received_quantity_base" <= 1000000
    AND "remaining_quantity_base" >= 0 AND "remaining_quantity_base" <= "received_quantity_base"
  ) NOT VALID;
