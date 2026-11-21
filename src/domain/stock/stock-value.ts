/**
 * @file stock-value.ts
 * @description What a quantity in stock is worth at a price per selling unit — the same exact
 * rule as a sale line (per kilo over grams for `kg`, per gram for `g`, per piece otherwise),
 * rounded once, half up, in integer piasters. Used by «الجرد» and its export so the screen and
 * the file show the same numbers.
 */
import { saleLineTotalPiasters } from "@/domain/sale-pricing";

export function stockValuePiasters(
  unit: string | null | undefined,
  quantityBase: number,
  pricePiasters: number | null | undefined,
): number {
  if (!(quantityBase > 0) || !pricePiasters || pricePiasters <= 0) return 0;
  return saleLineTotalPiasters(unit ?? "piece", pricePiasters, quantityBase);
}
