/**
 * Money calculations in integer piasters (1 EGP = 100 piasters).
 * Floating-point representation for money is strictly prohibited.
 */

export function assertIntegerPiasters(amount: number, label = "Amount"): void {
  if (!Number.isSafeInteger(amount)) {
    throw new TypeError(
      `${label} must be a safe integer in piasters, received: ${amount}`,
    );
  }
}

/**
 * Converts Egyptian Pounds (EGP) to integer piasters.
 */
export function egpToPiasters(egp: number): number {
  if (typeof egp !== "number" || !Number.isFinite(egp)) {
    throw new TypeError(`EGP amount must be a finite number, received: ${egp}`);
  }
  return Math.round(egp * 100);
}

/**
 * Converts integer piasters to decimal Egyptian Pounds (EGP).
 */
export function piastersToEgp(piasters: number): number {
  assertIntegerPiasters(piasters, "Piasters");
  return piasters / 100;
}

/**
 * Formats integer piasters to Egyptian Pounds string.
 * Example: 1550 -> "15.50 ج.م" (or with English locale "15.50 EGP")
 */
export function formatPiasters(
  piasters: number,
  options?: {
    locale?: "ar-EG" | "en-US";
    includeCurrency?: boolean;
  },
): string {
  assertIntegerPiasters(piasters, "Piasters");
  const locale = options?.locale ?? "ar-EG";
  const includeCurrency = options?.includeCurrency ?? true;

  const egpValue = piasters / 100;
  const formattedNumber = egpValue.toFixed(2);

  if (!includeCurrency) {
    return formattedNumber;
  }

  const currencySymbol = locale === "ar-EG" ? "ج.م" : "EGP";
  return locale === "ar-EG"
    ? `${formattedNumber} ${currencySymbol}`
    : `${formattedNumber} ${currencySymbol}`;
}

/**
 * Calculates line item total in integer piasters.
 */
export function calculateLineTotal(
  unitPricePiasters: number,
  quantity: number,
): number {
  assertIntegerPiasters(unitPricePiasters, "Unit price");
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new TypeError(
      `Quantity must be a non-negative integer, received: ${quantity}`,
    );
  }
  return unitPricePiasters * quantity;
}

/**
 * Applies percentage discount and returns the new total in integer piasters.
 */
export function applyDiscount(
  subtotalPiasters: number,
  discountPercent: number,
): number {
  assertIntegerPiasters(subtotalPiasters, "Subtotal");
  if (discountPercent < 0 || discountPercent > 100) {
    throw new RangeError(
      `Discount percent must be between 0 and 100, received: ${discountPercent}`,
    );
  }

  const discountPiasters = Math.round(
    (subtotalPiasters * discountPercent) / 100,
  );
  return Math.max(0, subtotalPiasters - discountPiasters);
}
