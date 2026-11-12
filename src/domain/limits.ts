/**
 * @file limits.ts
 * @description The upper bounds every quantity and money input is checked against
 * (audit QA-15). One place, used by the zod schemas and mirrored by database CHECKs.
 *
 * Why these values (assumptions logged in docs/01-product.md, decision D33):
 * - Money is integer piasters. One operation of a small Egyptian shop (a sale, an expense, a
 *   payment, a supplier bill, a purchase batch, a machine top-up) stays far below
 *   10,000,000 EGP; anything above is a typo (extra zeros). Sums of millions of such values
 *   stay below 2^53, so JavaScript numbers never lose precision.
 * - A unit price (per piece, per kg, per pack) above 1,000,000 EGP is not a supermarket item.
 * - Quantities are integer base units (pieces, or grams for weighed goods). 1,000,000 base
 *   units in ONE operation is a million pieces or one tonne — beyond any shop delivery.
 */

/** Largest single money amount: 10,000,000 EGP. */
export const MAX_AMOUNT_PIASTERS = 1_000_000_000;

/** Largest unit price (selling or buying, per selling unit): 1,000,000 EGP. */
export const MAX_UNIT_PRICE_PIASTERS = 100_000_000;

/** Largest quantity in one operation, in base units (pieces or grams). */
export const MAX_QUANTITY_BASE = 1_000_000;

/** Largest pack size (pieces in a carton / dozen / bag). */
export const MAX_PACK_QTY = 10_000;

/**
 * Longest owner (person) name, in characters (QA-58). Matches the People screen's contact
 * names (120): room for a full Egyptian four-part name with a title, far below abuse sizes.
 * Longer input is refused with a message, never cut.
 */
export const MAX_PERSON_NAME_LENGTH = 120;
