-- QA-32 (ADR-0027): indexes for the hot read paths. Every request to Neon pays ~63 ms per
-- round trip; these keep each of those queries an index lookup instead of a table scan as the
-- shops' data grows. Additive only: no row is read or changed.
--
-- On a large production table, the database owner may create these with CONCURRENTLY first
-- (outside a transaction); IF NOT EXISTS then makes this migration a no-op for them.

-- Every `include: saleLines` (sales list, reports, invoices, void, returns) filters by sale.
CREATE INDEX IF NOT EXISTS "idx_sale_lines_sale" ON "sale_lines" ("sale_id");
-- The sales list (latest 200) and the report periods: a store's sales by time.
CREATE INDEX IF NOT EXISTS "idx_sales_store_created" ON "sales" ("store_id", "created_at" DESC);
-- Product, stock and alert lists load a product's variants, and a store's variants.
CREATE INDEX IF NOT EXISTS "idx_store_variants_product" ON "store_variants" ("store_product_id");
CREATE INDEX IF NOT EXISTS "idx_store_variants_store" ON "store_variants" ("store_id");
-- Movement history (latest 100), restoring a sale line (void / return), opId replays.
CREATE INDEX IF NOT EXISTS "idx_stock_movements_store_created" ON "stock_movements" ("store_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_stock_movements_sale_line" ON "stock_movements" ("sale_line_id");
CREATE INDEX IF NOT EXISTS "idx_stock_movements_store_op" ON "stock_movements" ("store_id", "op_id");
