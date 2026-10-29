/**
 * Community Catalog & Suggestions Policy Constants
 * Values defined in accordance with docs/03-data.md and docs/01-product.md.
 */

/**
 * Minimum number of distinct adopting shops required before an open community
 * suggestion is eligible for promotion to the global catalog.
 */
export const MIN_ADOPTING_STORES_FOR_PROMOTION = 10;

/**
 * Minimum waiting period (in days) from publication before an open community
 * suggestion can be promoted to the global catalog. Both 7 full days AND 10 distinct
 * shops are strictly mandatory.
 */
export const MIN_PROMOTION_AGE_DAYS = 7;

/**
 * Milliseconds per day constant for deterministic time comparisons.
 */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Maximum community suggestion cards delivered to a shop per calendar day.
 */
export const MAX_DAILY_SUGGESTIONS_PER_STORE = 3;

/**
 * Report threshold triggering automatic candidate quarantine/hidden state.
 */
export const MAX_REPORTS_THRESHOLD = 5;
