/**
 * Quantities in integer base units:
 * - Piece goods: integer pieces (1, 2, 10...)
 * - Weighed goods: integer grams (e.g. 1.5 kg is stored as 1500 grams)
 * - Cartons/packs: pack quantity in base units (e.g. pack of 24 pieces)
 */

export function assertIntegerBaseQuantity(
  qty: number,
  label = "Quantity",
): void {
  if (!Number.isSafeInteger(qty)) {
    throw new TypeError(
      `${label} must be a safe integer in base units, received: ${qty}`,
    );
  }
}

/**
 * Converts grams to kilograms.
 */
export function gramsToKilograms(grams: number): number {
  assertIntegerBaseQuantity(grams, "Grams");
  return grams / 1000;
}

/**
 * Converts kilograms to integer grams.
 */
export function kilogramsToGrams(kg: number): number {
  if (typeof kg !== "number" || !Number.isFinite(kg)) {
    throw new TypeError(`Kilograms must be a finite number, received: ${kg}`);
  }
  return Math.round(kg * 1000);
}

/**
 * Converts carton/pack count to base unit pieces.
 */
export function packsToPieces(packs: number, packQty: number): number {
  assertIntegerBaseQuantity(packs, "Packs");
  assertIntegerBaseQuantity(packQty, "Pack quantity");
  if (packs < 0 || packQty <= 0) {
    throw new RangeError(
      `Packs must be non-negative and packQty must be positive (packs=${packs}, packQty=${packQty})`,
    );
  }
  return packs * packQty;
}

/**
 * Converts base unit pieces to packs and remaining loose pieces.
 */
export function piecesToPacks(
  pieces: number,
  packQty: number,
): { packs: number; remainderPieces: number } {
  assertIntegerBaseQuantity(pieces, "Pieces");
  assertIntegerBaseQuantity(packQty, "Pack quantity");
  if (pieces < 0 || packQty <= 0) {
    throw new RangeError(
      `Pieces must be non-negative and packQty must be positive (pieces=${pieces}, packQty=${packQty})`,
    );
  }
  const packs = Math.floor(pieces / packQty);
  const remainderPieces = pieces % packQty;
  return { packs, remainderPieces };
}

/**
 * Formats grams for display (e.g., in kilograms if >= 1000g, or grams if < 1000g).
 */
export function formatWeight(
  grams: number,
  options?: { locale?: "ar-EG" | "en-US" },
): string {
  assertIntegerBaseQuantity(grams, "Grams");
  const locale = options?.locale ?? "ar-EG";

  if (grams >= 1000) {
    const kg = grams / 1000;
    const formatted = Number.isInteger(kg)
      ? kg.toString()
      : kg.toFixed(3).replace(/\.?0+$/, "");
    return locale === "ar-EG" ? `${formatted} كجم` : `${formatted} kg`;
  }

  return locale === "ar-EG" ? `${grams} جم` : `${grams} g`;
}
