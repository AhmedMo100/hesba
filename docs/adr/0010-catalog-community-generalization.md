# ADR 0010: Community Catalog Generalization and Promotion Cycle

## Context
Hesba operates an Egyptian FMCG shared catalog across multiple independent store tenants. When a store merchant introduces a custom product not currently present in the global catalog, the system submits it as a `CatalogCandidate` to enable crowd-sourced catalog enrichment.

To prevent spam, duplicate clutter, and unauthorized product flooding, candidates must pass a two-tier community threshold before becoming widely visible or officially promoted:
1. **Discovery Notifications (> 50%)**: When more than 50% of eligible stores have added the product, the system initiates product discovery notifications to remaining eligible stores.
2. **Global Promotion (> 70% and >= 7 days)**: After exactly 1 full week (7 days) from publication, if more than 70% of eligible stores have adopted the candidate, it is automatically approved and promoted into the unified shared catalog.

## Architectural Clarifications & Decision

### 1. Definition of "Eligible Stores" (المحلات المؤهلة)
The denominator in the percentage calculation must be mathematically stable, deterministic, and auditable:
- **Eligible Store Criteria**:
  - Store `isActive = true`.
  - Store has community suggestions enabled (`shareCustomProducts = true` or `receiveSuggestions = true`).
  - Store is not a demo, test, or archived account.
- **Snapshot at Evaluation Start (`eligibleStoresSnapshot`)**:
  - When a candidate is first submitted or published, `eligibleStoresSnapshot` records the exact count of eligible stores at that point in time.
  - Using a snapshot prevents the denominator from fluctuating wildly when new stores sign up or close during the 7-day evaluation window.
  - If `eligibleStoresSnapshot` is 0 or 1 (e.g. single store during initial deployment), a minimum of 2 stores is required to avoid premature promotion by a single tenant.

### 2. Definition of "Store Addition / Adoption"
- A store is considered to have added the candidate if and only if a distinct row exists in `candidate_adoptions` linking `(candidate_id, store_id)`.
- Unique constraint `idx_candidate_adoptions_unique_store` strictly enforces that each shop is counted at most once.

### 3. Strict Inequality (> vs >=)
- Discovery Trigger: `adoptionsCount / eligibleStoresSnapshot > 0.50` (strictly greater than 50%).
- Promotion Trigger: `elapsedDays >= 7.0` AND `adoptionsCount / eligibleStoresSnapshot > 0.70` (strictly greater than 70%).

### 4. Idempotency & Duplicate Prevention
- Discovery notifications use `CatalogNotification` with `@@unique([storeId, candidateId])`. Repeated evaluation or cron retries can never insert duplicate notifications for the same store and product.
- Global promotion creates `GlobalProduct` and updates `CatalogCandidate.status = 'approved'` atomically inside a database transaction. Subsequent runs recognize `candidate.status === 'approved'` and exit cleanly without creating duplicates.
