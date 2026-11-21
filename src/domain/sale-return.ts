/**
 * @file sale-return.ts
 * @description What returning part of a sale line is worth. A line's total (after its share of
 * the invoice discount) is spread over its quantity; returning `qty` more after `prev` were
 * already returned is worth `upTo(prev + qty) − upTo(prev)`, so returns in several steps add
 * up exactly to the line's total — never a piaster more or less. Integer piasters and integer
 * base units (grams for weighed goods); BigInt, no floating point. Pure; used by the server to
 * record a return and by the sale's sheet to show it before confirming.
 */

export function returnValue(
  lineTotalPiasters: bigint,
  soldBase: number,
  alreadyReturnedBase: number,
  qtyBase: number,
): bigint {
  if (soldBase <= 0) return BigInt(0);
  const upTo = (n: number) =>
    (lineTotalPiasters * BigInt(n)) / BigInt(soldBase);
  return upTo(alreadyReturnedBase + qtyBase) - upTo(alreadyReturnedBase);
}
