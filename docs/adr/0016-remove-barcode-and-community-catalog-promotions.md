# ADR-0016: Complete Removal of Barcode & Safe Community Product Promotions

- **Status:** Accepted
- **Date:** 2026-10-29
- **Decision-maker:** Ahmed Tarek / Team Hesba

## Context
In Egyptian small groceries, kiosks, and supermarkets (Hesba's primary target audience), barcodes are rarely scanned using handheld hardware on mobile-first workflows. Furthermore, many Egyptian retail goods (local baked goods, cheeses, fresh produce, repackaged dry staples, loose pulses, spices, and informal snacks) lack manufacturer barcodes or feature non-standard manufacturer codes that clash across uncertified suppliers. Relying on barcode as a primary, unique, or mandatory identifier complicated the schema and created friction for retailers.

Additionally, to build a crowdsourced yet high-quality shared product catalog without burdening store owners, custom products added by stores need a robust, privacy-preserving, and abuse-resistant path to promotion into the global catalog (`global_products` and `global_variants`).

## Decision

1. **Complete Barcode Removal:**
   - Remove `barcode` columns from `global_variants`, `store_variants`, `catalog_candidates`, and local Dexie schemas (`LocalStoreVariant`).
   - Remove barcode fields from catalog CSV templates (`variants.csv`) and ingestion tooling (`scripts/import-catalog.ts`).
   - Prohibit using barcode as a uniqueness constraint, matching key, or mandatory form field.
   - Match products solely through multi-field fuzzy Arabic normalization (`name_norm`), brand validation, flavor matching, pack quantity, and physical unit equality (e.g., 1000g == 1kg, 1000ml == 1L).

2. **Community Product Suggestions & Promotion Invariant:**
   - Stores can add custom products (`is_custom = true`).
   - Store prices and stock levels **never leak** to other stores or to the candidate catalog.
   - Adding a custom product creates a deduplicated candidate (`catalog_candidates`) with `status = 'pending'`.
   - Other stores can discover and adopt the candidate (`candidate_adoptions`).
   - Strict promotion invariant: A candidate is promoted to `global_products` and `global_variants` (`status = 'approved'`) **if and only if**:
     1. Candidate age is at least 7 days (`MIN_PROMOTION_AGE_DAYS = 7`), **AND**
     2. Unique adopting stores count is at least 10 (`MIN_ADOPTING_STORES_FOR_PROMOTION = 10`), **OR**
     3. Manual review / approval by administrator.
   - Spam/abuse protection:
     - Rate-limit suggestion submission to at most 3 custom suggestions per store per day.
     - Automatically hide candidate if report threshold is reached (5 reports from distinct stores).
     - Store identity is anonymized; submitting store ID is never exposed in candidate discovery.

## Consequences
- **Positive:**
  - Frictionless mobile onboarding and fast Arabic search.
  - No dependency on barcode scanners or third-party barcode databases.
  - Zero pollution of the global catalog from fly-by-night or one-off custom items.
  - Strict privacy: stores never see competitor pricing or vendor sources.
- **Risks & Mitigations:**
  - Similar names could collide without barcode; mitigated by multi-attribute matching (`src/domain/product-matcher.ts`) enforcing physical unit equality and distinct flavor/brand checks before declaring an exact or potential match.
