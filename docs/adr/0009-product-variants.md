# ADR-0009: Product variants

- **Status:** Accepted
- **Date:** 2026-10-24
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
In Egyptian grocery stores and supermarkets (`docs/07-PRODUCT-BRIEF.md`), many commercial products exist in multiple variations (e.g. flavors, packaging sizes, weights, or pack quantities) under a single parent product or brand. For example, a single snack or beverage brand contains multiple flavors (salted, cheese, chili) and sizes (250ml, 1L, single piece, carton of 12).
Previously, products were modeled flatly, causing duplication of product definitions or ambiguity regarding whether barcode, pricing, and stock inventory belong to the product or its specific packaging/flavor option.

## Options
1. **Option A: Flat products only (each flavor/size is a separate standalone product)**
   - **Pros:** Simpler schema initially.
   - **Cons:** Cluttered search results, duplicated brand/category metadata, hard to browse family lines, and awkward handling of multi-pack vs single piece.
2. **Option B: Products with variants (every sellable item is a product variant)**
   - **Pros:** Clean domain model matching retail realities. Every sellable item is a product. A product can have variants (flavor, size value, size unit, pack quantity, barcode). Stock, selling price, and barcode belong directly to the variant, not the parent product. A shop can link a variant to the shared catalog (`global_variants`) or define custom variants (`store_variants`).
   - **Cons:** Slightly more relational joins/normalization in database queries and IndexedDB caching.

## Decision
We chose **Option B: Product variants**.

Every sellable item is a product. A product can have variants (flavor, size value, size unit, pack quantity). Stock and selling price belong strictly to the variant, not the parent product. A shop either links a variant to the global catalog or creates its own custom variant.
*(Note: Barcode was removed across all variants per ADR-0016).*

## Consequences
- **Positive:**
  - Clear separation of concerns: brands and base product names live at the product level; sellable barcode, price, and inventory batches live at the variant level.
  - Better catalog discovery and deduplication across shops.
  - Natural support for multi-pack carton breaking into piece units.
- **Negative/risks:**
  - Schema updates needed in `docs/09-DATABASE-SCHEMA.md` (`brands`, `global_products`, `global_variants`, `store_variants`, `store_stock_batches`).
  - Local Dexie tables and sync protocol must sync and index variants.
- **What must change:**
  - `docs/09-DATABASE-SCHEMA.md`: update schema table descriptions.
  - `docs/04-TASKS.md`: add task `P3-B-10` (variants model).
  - `docs/15-DECISIONS-AND-OPEN-QUESTIONS.md`: record ADR-0009 as accepted.
- **When to revisit:**
  - If a large supermarket requires multi-dimensional matrix variants (e.g. 3+ concurrent variant axes) beyond flavor/size/pack.
