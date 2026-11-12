/**
 * @file sale-pricing.ts
 * @description Pure rules the server uses to price a sale (ADR-0019): the line total of an
 * ordinary product, which products are services (no stock), and how a promotion's price is
 * split across its lines. Shared with the client so both sides classify products the same way.
 */

import { costBasisForUnit, ingredientCostPiasters } from "./recipe";
import { MAX_QUANTITY_BASE } from "./limits";

/**
 * Category names of telecom/payment service products (top-ups, bills, transfers, cards).
 * "خدمات وفواتير" is the category the server gives a service sold before it existed in the
 * shop's products.
 */
export const SERVICE_CATEGORIES: readonly string[] = [
  "فواتير إنترنت",
  "شحن رصيد",
  "تحويل أموال",
  "خدمات مرافق",
  "خدمات رقمية",
  "كروت شحن",
  "كروت مرافق",
  "خدمات وفواتير",
];

/**
 * True for service products. Services have no physical stock: they are sold against a POS
 * machine balance, so a sale of a service never touches stock.
 */
export function isServiceProduct(p: {
  category?: string | null;
  unit?: string | null;
}): boolean {
  return (
    p.unit === "service" ||
    (p.category != null && SERVICE_CATEGORIES.includes(p.category))
  );
}

/** Largest quantity accepted on one sale line, in base units (QA-15: the shared bound). */
export const MAX_SALE_QUANTITY_BASE = MAX_QUANTITY_BASE;

/**
 * Total of one ordinary sale line in piasters, from the product's registered selling price.
 *
 * - `kg` products: the price is per kilogram and `quantityBase` is grams → qty × price / 1000.
 * - `g` products and everything else: price × quantity (a carton is `packQty` pieces).
 *
 * Calculated exactly and rounded once, half up — the same rule as sandwich costs.
 */
export function saleLineTotalPiasters(
  unit: string | null | undefined,
  sellPricePiasters: number,
  quantityBase: number,
): number {
  return ingredientCostPiasters(
    quantityBase,
    sellPricePiasters,
    costBasisForUnit(unit),
  );
}

/**
 * Splits `totalPiasters` across lines in proportion to `weights` (largest remainder), so the
 * parts are whole piasters and add up exactly to the total. Equal weights are used when every
 * weight is zero.
 */
export function allocateByWeight(
  totalPiasters: number,
  weights: readonly number[],
): number[] {
  if (!Number.isSafeInteger(totalPiasters) || totalPiasters < 0) {
    throw new RangeError("Total must be a non-negative safe integer");
  }
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new RangeError("Weights must be non-negative safe integers");
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const effective = sum === 0 ? weights.map(() => 1) : weights;
  const weightSum = BigInt(sum === 0 ? weights.length : sum);
  const total = BigInt(totalPiasters);

  const parts = effective.map((w) => (total * BigInt(w)) / weightSum);
  const remainders = effective.map((w, i) => ({
    i,
    rem: (total * BigInt(w)) % weightSum,
  }));
  let left = Number(total - parts.reduce((a, b) => a + b, BigInt(0)));
  remainders.sort((a, b) =>
    a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1,
  );
  for (const r of remainders) {
    if (left <= 0) break;
    parts[r.i] = parts[r.i]! + BigInt(1);
    left -= 1;
  }
  return parts.map((p) => Number(p));
}
