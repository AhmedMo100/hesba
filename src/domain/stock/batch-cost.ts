/**
 * @file batch-cost.ts
 * @description The canonical cost model of a stock batch (ADR-0021, audit QA-08).
 *
 * - `cost_total_minor` (piasters) is what the shop paid for the batch's whole received
 *   quantity. It is the authority; `null` = unknown.
 * - `cost_price_minor` (piasters) is the unit cost per SELLING unit, derived from the total:
 *   per kilogram for `kg` products, per gram for `g`, per piece otherwise — the same basis as
 *   a product's registered `buy_price_piasters`. `null` when the total is unknown.
 * - Quantities are base units (grams for weighed goods, pieces otherwise).
 *
 * Costs of a part of a batch (a sale, a waste, an adjustment) are proportional to the TOTAL,
 * computed exactly in milli-piasters and rounded once, so splitting a batch never loses or
 * invents piasters beyond that single rounding.
 */

const ZERO = BigInt(0);
const THOUSAND = BigInt(1000);
const HALF_THOUSAND = BigInt(500);

/** Base units in one selling unit: 1000 g per kg for `kg` products, 1 otherwise. */
export function baseUnitsPerSellingUnit(
  unit: string | null | undefined,
): number {
  return unit === "kg" ? 1000 : 1;
}

function assertWhole(value: bigint | number, label: string): bigint {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  if (v < ZERO) throw new RangeError(`${label} cannot be negative`);
  return v;
}

/** Divides and rounds half up (both operands non-negative). */
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2));
}

/**
 * Unit cost per selling unit from the batch total, rounded half up.
 * Example: 20 pieces for 160.00 → 8.00; 1000 g for 160.00 → 160.00 per kg.
 * Returns null when the total is unknown or the quantity is 0.
 */
export function unitCostFromTotal(
  totalPiasters: bigint | number | null | undefined,
  receivedBase: bigint | number,
  unit: string | null | undefined,
): bigint | null {
  if (totalPiasters === null || totalPiasters === undefined) return null;
  const total = assertWhole(totalPiasters, "Total cost");
  const qty = assertWhole(receivedBase, "Quantity");
  if (qty === ZERO) return null;
  return divRound(total * BigInt(baseUnitsPerSellingUnit(unit)), qty);
}

/**
 * Batch total from a unit cost per selling unit (used when a batch is created from a
 * registered buy price: initial stock, a stock increase by adjustment). Rounded half up.
 * Returns null when the unit cost is unknown.
 */
export function totalFromUnitCost(
  unitCostPiasters: bigint | number | null | undefined,
  quantityBase: bigint | number,
  unit: string | null | undefined,
): bigint | null {
  if (unitCostPiasters === null || unitCostPiasters === undefined) return null;
  const unitCost = assertWhole(unitCostPiasters, "Unit cost");
  const qty = assertWhole(quantityBase, "Quantity");
  return divRound(unitCost * qty, BigInt(baseUnitsPerSellingUnit(unit)));
}

/**
 * Exact cost of taking `takenBase` units out of a batch, in milli-piasters (proportional to
 * the batch total). Null when the batch cost is unknown.
 */
export function takeCostMilli(
  batchTotalPiasters: bigint | null | undefined,
  receivedBase: bigint,
  takenBase: bigint,
): bigint | null {
  if (batchTotalPiasters === null || batchTotalPiasters === undefined) {
    return null;
  }
  if (receivedBase <= ZERO) return null;
  return (batchTotalPiasters * takenBase * THOUSAND) / receivedBase;
}

/** Rounds milli-piasters to whole piasters, half up. */
export function milliToWholePiasters(milli: bigint): bigint {
  if (milli < ZERO) throw new RangeError("Cost cannot be negative");
  return (milli + HALF_THOUSAND) / THOUSAND;
}

/**
 * Total cost of several takes (e.g. one sale line drawing from two batches): the sum of the
 * exact parts, rounded once. Null when ANY part is unknown — a partly known cost is not a
 * cost (it is never estimated).
 */
export function sumTakeCosts(
  parts: ReadonlyArray<bigint | null>,
): bigint | null {
  let milli = ZERO;
  for (const p of parts) {
    if (p === null) return null;
    milli += p;
  }
  return milliToWholePiasters(milli);
}
