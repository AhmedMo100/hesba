-- Migration: 20261109000000_sandwich_products
-- Sandwiches as composite products (ADR-0018). Additive only.
--   1. store_products.kind      'standard' | 'sandwich'
--   2. sale_lines.cost_piasters  cost snapshot of a line at sale time (sandwich lines)
--   3. sandwich_ingredients      recipe lines, store-scoped with FORCE RLS

-- 1. Product kind -------------------------------------------------------------------------
ALTER TABLE "store_products"
    ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE "store_products" DROP CONSTRAINT IF EXISTS "chk_store_products_kind";
ALTER TABLE "store_products"
    ADD CONSTRAINT "chk_store_products_kind" CHECK ("kind" IN ('standard', 'sandwich'));

-- 2. Cost snapshot on sale lines ------------------------------------------------------------
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "cost_piasters" BIGINT;

ALTER TABLE "sale_lines" DROP CONSTRAINT IF EXISTS "chk_sale_lines_cost_non_negative";
ALTER TABLE "sale_lines"
    ADD CONSTRAINT "chk_sale_lines_cost_non_negative"
    CHECK ("cost_piasters" IS NULL OR "cost_piasters" >= 0);

-- 3. Recipe lines -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sandwich_ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "store_id" UUID NOT NULL,
    "sandwich_product_id" UUID NOT NULL,
    "ingredient_variant_id" UUID NOT NULL,
    "quantity_base" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandwich_ingredients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sandwich_ingredients_store_id_fkey" FOREIGN KEY ("store_id")
        REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sandwich_ingredients_sandwich_product_id_fkey" FOREIGN KEY ("sandwich_product_id")
        REFERENCES "store_products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sandwich_ingredients_ingredient_variant_id_fkey" FOREIGN KEY ("ingredient_variant_id")
        REFERENCES "store_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "chk_sandwich_ingredients_quantity_positive" CHECK ("quantity_base" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_sandwich_ingredients_sandwich_variant"
    ON "sandwich_ingredients" ("sandwich_product_id", "ingredient_variant_id");
CREATE INDEX IF NOT EXISTS "idx_sandwich_ingredients_store_sandwich"
    ON "sandwich_ingredients" ("store_id", "sandwich_product_id");
CREATE INDEX IF NOT EXISTS "idx_sandwich_ingredients_store_variant"
    ON "sandwich_ingredients" ("store_id", "ingredient_variant_id");

ALTER TABLE "sandwich_ingredients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sandwich_ingredients" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation" ON "sandwich_ingredients";
CREATE POLICY "tenant_isolation" ON "sandwich_ingredients"
    USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
    WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

DROP POLICY IF EXISTS "sandwich_ingredients_migrator_all" ON "sandwich_ingredients";
CREATE POLICY "sandwich_ingredients_migrator_all" ON "sandwich_ingredients"
    AS PERMISSIVE FOR ALL TO hesba_migrator USING (true) WITH CHECK (true);

-- Recipe lines are configuration: editing a sandwich replaces them (DELETE is needed).
GRANT SELECT, INSERT, UPDATE, DELETE ON "sandwich_ingredients" TO hesba_app;

-- Foreign keys are checked without RLS, so they alone would accept another store's variant.
-- This trigger requires the sandwich and the ingredient to belong to the row's store, the
-- parent to be a sandwich, and the ingredient not to be a sandwich.
CREATE OR REPLACE FUNCTION "hesba_check_sandwich_ingredient"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_parent_store UUID;
    v_parent_kind TEXT;
    v_ingredient_store UUID;
    v_ingredient_kind TEXT;
BEGIN
    SELECT store_id, kind INTO v_parent_store, v_parent_kind
      FROM store_products WHERE id = NEW.sandwich_product_id;
    IF v_parent_store IS DISTINCT FROM NEW.store_id OR v_parent_kind IS DISTINCT FROM 'sandwich' THEN
        RAISE EXCEPTION 'sandwich_ingredients: parent must be a sandwich of the same store'
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT v.store_id, p.kind INTO v_ingredient_store, v_ingredient_kind
      FROM store_variants v
      LEFT JOIN store_products p ON p.id = v.store_product_id
     WHERE v.id = NEW.ingredient_variant_id;
    IF v_ingredient_store IS DISTINCT FROM NEW.store_id THEN
        RAISE EXCEPTION 'sandwich_ingredients: ingredient must belong to the same store'
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_ingredient_kind = 'sandwich' THEN
        RAISE EXCEPTION 'sandwich_ingredients: a sandwich cannot be an ingredient'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "trg_sandwich_ingredients_check" ON "sandwich_ingredients";
CREATE TRIGGER "trg_sandwich_ingredients_check"
    BEFORE INSERT OR UPDATE ON "sandwich_ingredients"
    FOR EACH ROW EXECUTE FUNCTION "hesba_check_sandwich_ingredient"();
