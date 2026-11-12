/**
 * @file sandwich-quantity.ts
 * @description Pure rules for the "how many sandwiches?" step that "إضافة إلى البيع" opens on
 * the sales screen. The sale itself is still one `POST /api/sales` of N sandwiches; the
 * server re-checks the ingredients, so `availableCount` here is only a hint.
 */

import { calculateLineTotal } from "@/domain/money";
import { normalizeArabic } from "@/domain/normalize";

/** Largest quantity accepted in one sale from this step. */
export const MAX_SANDWICH_SALE_QUANTITY = 999;

export type QuantityCheck =
  | { ok: true; quantity: number; totalPiasters: number }
  | {
      ok: false;
      reason: "invalid" | "too_many" | "not_enough";
      quantity: number | null;
    };

/**
 * Parses the typed quantity (Arabic digits allowed): a whole number from 1. Anything else in
 * the text ("2 3", "3abc", "1.5") is rejected rather than stripped, so a typo can never turn
 * into a different quantity.
 */
export function parseSaleQuantity(text: string): number | null {
  const clean = normalizeArabic(text);
  if (!/^\d+$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Validates a quantity against the limit and the ingredient stock hint, and prices it with
 * the shared money rule (`calculateLineTotal`, integer piasters).
 */
export function checkSandwichQuantity(
  text: string,
  unitPricePiasters: number,
  availableCount: number,
): QuantityCheck {
  const quantity = parseSaleQuantity(text);
  if (quantity === null) return { ok: false, reason: "invalid", quantity };
  if (quantity > MAX_SANDWICH_SALE_QUANTITY) {
    return { ok: false, reason: "too_many", quantity };
  }
  if (quantity > availableCount) {
    return { ok: false, reason: "not_enough", quantity };
  }
  return {
    ok: true,
    quantity,
    totalPiasters: calculateLineTotal(unitPricePiasters, quantity),
  };
}

/** Next quantity after pressing + or −, kept within 1 … min(available, max). */
export function stepQuantity(
  current: number | null,
  delta: 1 | -1,
  availableCount: number,
): number {
  const upper = Math.max(
    1,
    Math.min(availableCount, MAX_SANDWICH_SALE_QUANTITY),
  );
  const base = current ?? 1;
  return Math.min(upper, Math.max(1, base + delta));
}
