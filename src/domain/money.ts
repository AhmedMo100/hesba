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

/**
 * Normalizes Eastern Arabic (٠-٩) and Persian (۰-۹) numerals,
 * Arabic decimal separator (٫), and Arabic/Latin thousands separators (٬, ,)
 * into a clean standard numeric string.
 */
export function normalizeNumberString(input: string): string {
  if (!input) return "";
  let s = input.trim();
  // Replace Eastern Arabic-Indic numerals (٠-٩)
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  // Replace Persian / Extended Arabic-Indic numerals (۰-۹)
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  // Remove thousand separators: Arabic thousands (٬) and Latin comma (,)
  s = s.replace(/[\u066C,]/g, "");
  // Replace Arabic decimal separator (٫) with standard dot (.)
  s = s.replace(/\u066B/g, ".");
  // Strip any extra non-numeric characters except leading minus or decimal dot
  s = s.replace(/[^\d.-]/g, "");
  return s;
}

/**
 * Parses user input in Egyptian Pounds (EGP) — supporting Arabic digits,
 * commas, and decimals — and returns safe integer piasters (1 EGP = 100 piasters).
 * Avoids floating-point precision drift.
 * Examples:
 *   "1500" -> 150000
 *   "١٥٠٠" -> 150000
 *   "150.50" -> 15050
 *   "١٥٠٫٥٠" -> 15050
 *   "1,500" -> 150000
 *   "١٬٥٠٠" -> 150000
 */
export function parseEgpToPiasters(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return 0;
    return Math.round(input * 100);
  }
  if (typeof input !== "string") return 0;
  const clean = normalizeNumberString(input);
  if (!clean || clean === "-") return 0;

  const parts = clean.split(".");
  const integerPart = parseInt(parts[0] || "0", 10);
  if (isNaN(integerPart) || integerPart < 0) return 0;

  let fractionalPart = 0;
  if (parts.length > 1 && parts[1]) {
    const fractionString = parts[1].slice(0, 2).padEnd(2, "0");
    fractionalPart = parseInt(fractionString, 10);
    if (isNaN(fractionalPart)) fractionalPart = 0;
  }

  return integerPart * 100 + fractionalPart;
}
