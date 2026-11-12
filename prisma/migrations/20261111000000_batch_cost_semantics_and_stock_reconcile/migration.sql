-- ADR-0021 (audit QA-05, QA-07, QA-08): one cost model for stock batches, and one source of
-- truth for stock quantities. This migration changes the meaning of no column silently: every
-- rewrite below is classified, deterministic and documented in docs/adr/0021-*.md.
--
-- Canonical semantics after this migration:
--   store_stock_batches.cost_total_minor  what was paid for the batch's received quantity
--                                         (the authority; NULL = unknown)
--   store_stock_batches.cost_price_minor  unit cost per SELLING unit (per kg for `kg`
--                                         products, per gram for `g`, per piece otherwise),
--                                         derived from the total, rounded half up (NULL = unknown)
--   stock_movements.cost_price_minor      the batch's unit cost (same basis) for movements written
--                                         from now on; older rows are NOT rewritten (append-only)
--   waste_records.cost_minor              cost of the wasted quantity (share of the batch total)
--   sale_lines.cost_piasters              cost of the line at sale time (NULL = unknown)
--   stock_levels.quantity_base            a cache of the movement ledger (Σ quantity_base)
--
-- Runs per store with app.store_id set, so FORCE RLS applies exactly as for the app.

ALTER TABLE "store_stock_batches" ALTER COLUMN "cost_price_minor" DROP NOT NULL;

DO $migration$
DECLARE
  st uuid;
  var_row record;
  batch_row record;
  ledger bigint;
  batches bigint;
  excess bigint;
  take bigint;
BEGIN
  FOR st IN
    SELECT store_id FROM store_stock_batches
    UNION SELECT store_id FROM stock_movements
    UNION SELECT store_id FROM stock_levels
  LOOP
    PERFORM set_config('app.store_id', st::text, true);

    -- 1. Batch costs, classified by the movement that created the batch.
    --    `purchase` (Add-Stock screen): the client sent the TOTAL paid in cost_price_minor
    --    (its field is labelled "إجمالي سعر الشراء"), so total := that value and the unit
    --    cost is derived from it.
    WITH creator AS (
      SELECT b.id, b.received_quantity_base AS qty, b.cost_price_minor AS old_cost,
             CASE WHEN p.unit = 'kg' THEN 1000 ELSE 1 END AS f,
             (SELECT m.type FROM stock_movements m
               WHERE m.batch_id = b.id AND m.quantity_base > 0
               ORDER BY m.created_at LIMIT 1) AS made_by
        FROM store_stock_batches b
        LEFT JOIN store_variants sv ON sv.id = b.store_variant_id
        LEFT JOIN store_products p ON p.id = sv.store_product_id
       WHERE b.store_id = st
    )
    UPDATE store_stock_batches t
       SET cost_total_minor = c.old_cost,
           cost_price_minor = CASE WHEN c.qty > 0 AND c.old_cost IS NOT NULL
                                   THEN (c.old_cost * c.f * 2 + c.qty) / (c.qty * 2)
                                   ELSE NULL END
      FROM creator c
     WHERE t.id = c.id AND c.made_by = 'purchase';

    --    `initial_stock` / `adjustment` / no creating movement: the value was the registered
    --    buy price per selling unit (the unit cost). 0 meant "no price registered" → unknown.
    --    The total is recomputed (it was unit × base quantity, wrong by 1000× for `kg`).
    WITH creator AS (
      SELECT b.id, b.received_quantity_base AS qty, b.cost_price_minor AS unit_cost,
             CASE WHEN p.unit = 'kg' THEN 1000 ELSE 1 END AS f,
             (SELECT m.type FROM stock_movements m
               WHERE m.batch_id = b.id AND m.quantity_base > 0
               ORDER BY m.created_at LIMIT 1) AS made_by
        FROM store_stock_batches b
        LEFT JOIN store_variants sv ON sv.id = b.store_variant_id
        LEFT JOIN store_products p ON p.id = sv.store_product_id
       WHERE b.store_id = st
    )
    UPDATE store_stock_batches t
       SET cost_price_minor = NULLIF(c.unit_cost, 0),
           cost_total_minor = CASE WHEN COALESCE(c.unit_cost, 0) > 0
                                   THEN (c.unit_cost * c.qty * 2 + c.f) / (c.f * 2)
                                   ELSE NULL END
      FROM creator c
     WHERE t.id = c.id AND (c.made_by IS NULL OR c.made_by <> 'purchase');

    -- 2. (No rewrite of stock_movements: the ledger is append-only. Historical movements keep
    --    the cost_price_minor recorded at the time; cost readers use the batch total.)

    -- 3. Waste tied to a batch costs its share of the batch total (unknown total → left as is).
    UPDATE waste_records w
       SET cost_minor = (b.cost_total_minor * w.quantity_base * 2 + b.received_quantity_base)
                        / (b.received_quantity_base * 2)
      FROM store_stock_batches b
     WHERE w.store_id = st AND w.batch_id = b.id
       AND b.cost_total_minor IS NOT NULL AND b.received_quantity_base > 0;

    -- 4. Quantities: the movement ledger is the source of truth (QA-05).
    FOR var_row IN
      SELECT store_variant_id AS id FROM stock_movements WHERE store_id = st
      UNION SELECT store_variant_id FROM store_stock_batches WHERE store_id = st
      UNION SELECT store_variant_id FROM stock_levels WHERE store_id = st
    LOOP
      SELECT COALESCE(SUM(quantity_base), 0) INTO ledger
        FROM stock_movements WHERE store_id = st AND store_variant_id = var_row.id;
      SELECT COALESCE(SUM(remaining_quantity_base), 0) INTO batches
        FROM store_stock_batches WHERE store_id = st AND store_variant_id = var_row.id;

      IF batches > GREATEST(ledger, 0) THEN
        -- Batches hold more than the ledger: quantity left by takes that never touched the
        -- batches (waste without a batch, races before ADR-0019). Remove the excess FEFO —
        -- the order the system uses for any take without a chosen batch.
        excess := batches - GREATEST(ledger, 0);
        FOR batch_row IN
          SELECT id, remaining_quantity_base AS rem FROM store_stock_batches
           WHERE store_id = st AND store_variant_id = var_row.id AND remaining_quantity_base > 0
           ORDER BY expiry_date ASC NULLS LAST, received_at ASC, id ASC
        LOOP
          EXIT WHEN excess <= 0;
          take := LEAST(batch_row.rem, excess);
          UPDATE store_stock_batches
             SET remaining_quantity_base = remaining_quantity_base - take, updated_at = now()
           WHERE id = batch_row.id;
          excess := excess - take;
        END LOOP;
      ELSIF batches < ledger THEN
        -- The ledger holds more than the batches: record the difference as a reconciliation
        -- batch whose cost is UNKNOWN (no cost is invented).
        INSERT INTO store_stock_batches
          (store_id, store_variant_id, store_product_id, batch_code,
           received_quantity_base, remaining_quantity_base, cost_price_minor, cost_total_minor,
           received_at, paid, created_at, updated_at)
        SELECT st, sv.id, sv.store_product_id, 'RECON-QA05',
               ledger - batches, ledger - batches, NULL, NULL, now(), true, now(), now()
          FROM store_variants sv WHERE sv.id = var_row.id;
      END IF;

      INSERT INTO stock_levels (store_id, store_variant_id, quantity_base, updated_at)
      VALUES (st, var_row.id, ledger, now())
      ON CONFLICT (store_id, store_variant_id)
      DO UPDATE SET quantity_base = EXCLUDED.quantity_base, updated_at = now();
    END LOOP;

    -- 5. Sale-line costs from the recorded batch takes, only when EVERY part of the line has
    --    a known batch cost (a partly known cost is not filled in). Sandwich lines already
    --    carry their snapshot and are not touched.
    UPDATE sale_lines l
       SET cost_piasters = x.cost
      FROM (
        SELECT m.sale_line_id,
               (SUM(b.cost_total_minor * (-m.quantity_base) * 1000 / b.received_quantity_base)
                + 500) / 1000 AS cost
          FROM stock_movements m
          LEFT JOIN store_stock_batches b ON b.id = m.batch_id
         WHERE m.store_id = st AND m.type = 'sale' AND m.sale_line_id IS NOT NULL
         GROUP BY m.sale_line_id
        HAVING bool_and(b.id IS NOT NULL AND b.cost_total_minor IS NOT NULL
                        AND b.received_quantity_base > 0)
      ) x
     WHERE l.id = x.sale_line_id AND l.store_id = st AND l.cost_piasters IS NULL;
  END LOOP;
END
$migration$;
