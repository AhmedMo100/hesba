/**
 * Pure helpers for the product form's bidirectional price sync.
 * No React, no side effects.
 */

/**
 * Format a computed price string: 2 decimal places, drop trailing ".00".
 * This matches the inline pattern used throughout ProductFormModal.
 */
export function formatPrice(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

/** Pack price → piece price: packPrice / packQty. */
export function packToPiecePrice(packPrice: string, packQty: string): string | null {
  const n = parseFloat(packQty);
  const p = parseFloat(packPrice);
  if (isNaN(n) || n <= 0 || isNaN(p)) return null;
  return formatPrice(p / n);
}

/** Piece price → pack price: piecePrice × packQty. */
export function pieceToPackPrice(piecePrice: string, packQty: string): string | null {
  const n = parseFloat(packQty);
  const p = parseFloat(piecePrice);
  if (isNaN(n) || n <= 0 || isNaN(p)) return null;
  return formatPrice(p * n);
}

/**
 * When pack quantity changes, recalculate both sell and buy prices.
 * Returns which fields should be updated.
 */
export function recalcOnPackQtyChange(
  newPackQty: string,
  pkSell: string,
  pcSell: string,
  pkBuy: string,
  pcBuy: string,
): {
  pcSell?: string;
  pkSell?: string;
  pcBuy?: string;
  pkBuy?: string;
} {
  const n = parseFloat(newPackQty);
  if (isNaN(n) || n <= 0) return {};

  const result: ReturnType<typeof recalcOnPackQtyChange> = {};

  if (pkSell && !pcSell) {
    result.pcSell = formatPrice(parseFloat(pkSell) / n);
  } else if (pcSell) {
    result.pkSell = formatPrice(parseFloat(pcSell) * n);
  }

  if (pkBuy && !pcBuy) {
    result.pcBuy = formatPrice(parseFloat(pkBuy) / n);
  } else if (pcBuy) {
    result.pkBuy = formatPrice(parseFloat(pcBuy) * n);
  }

  return result;
}
