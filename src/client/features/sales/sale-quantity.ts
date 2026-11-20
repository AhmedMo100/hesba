/**
 * @file sale-quantity.ts
 * @description What the sell sheet asks for, from how the product is really sold — the same
 * reading of the product as the «دخلت بضاعة» form (`entryShape`), so selling and stocking
 * never disagree: pieces / jars / bags / cartons by count, packs next to their units, a bag's
 * contents, or a weight in kilos or grams. The amount uses the server's own pricing rule
 * (`saleLineTotalPiasters`). Pure.
 */

import {
  entryShape,
  withAl,
  type EntryShape,
} from "@/client/features/stock/stock-entry.logic";
import { saleLineTotalPiasters } from "@/domain/sale-pricing";
import type { DisplaySaleItem } from "./sales.logic";

export type SaleUnit = "base" | "pack";
export type WeightUnit = "kg" | "g";

export function saleShape(item: DisplaySaleItem): EntryShape {
  return entryShape({
    variantId: item.variantId ?? item.id,
    productId: item.productId,
    productName: item.name,
    unitMode: item.unitMode === "weight" ? "weight" : "piece",
    packQty: item.packQty,
    currentStockBase: item.currentStockBase,
    unit: item.unit,
    category: item.category,
    packName: item.packName ?? null,
    sizeValue: item.sizeValue ?? null,
    sizeUnit: item.sizeUnit ?? null,
  });
}

const n = (v: string) => {
  const x = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/** Base units (grams for weighed goods) for what was typed. */
export function saleBaseQty(
  shape: EntryShape,
  qty: string,
  unit: SaleUnit,
  weightUnit: WeightUnit,
): number {
  if (shape.kind === "weight") {
    return Math.round(weightUnit === "kg" ? n(qty) * 1000 : n(qty));
  }
  const count = Math.round(n(qty));
  return unit === "pack" && shape.pack ? count * shape.pack.qty : count;
}

/** The line's amount in piasters, priced exactly as the server prices it. */
export function saleAmount(item: DisplaySaleItem, base: number): number {
  if (base <= 0) return 0;
  // A product weighed by the kilo: price per kilo over grams.
  const unit =
    item.unitMode === "weight" && item.unit !== "g" ? "kg" : item.unit;
  return saleLineTotalPiasters(unit, item.sellPricePiasters, base);
}

/** «عدد الكراتين» / «عدد البرطمانات» / «الوزن بالكيلو». */
export function saleQtyLabel(
  shape: EntryShape,
  unit: SaleUnit,
  weightUnit: WeightUnit,
): string {
  if (shape.kind === "weight")
    return weightUnit === "kg" ? "الوزن بالكيلو" : "الوزن بالجرام";
  return unit === "pack" && shape.pack
    ? `عدد ${shape.pack.plural}`
    : `عدد ${shape.plural}`;
}

/** The registered price of what is being sold: «سعر الكيلو 320 ج» / «سعر الكرتونة 165 ج». */
export function salePriceLine(
  item: DisplaySaleItem,
  shape: EntryShape,
  unit: SaleUnit,
): { label: string; piasters: number } {
  if (shape.kind === "weight") {
    const perKg =
      item.unit === "g"
        ? item.sellPricePiasters * 1000
        : item.sellPricePiasters;
    return { label: "سعر الكيلو", piasters: perKg };
  }
  if (unit === "pack" && shape.pack) {
    return {
      label: `سعر ${withAl(shape.pack.one)}`,
      piasters: item.sellPricePiasters * shape.pack.qty,
    };
  }
  return {
    label: `سعر ${withAl(shape.one)}`,
    piasters: item.sellPricePiasters,
  };
}

/** What the sale line says: «2 كرتونة» / «3 برطمان» / «750 جرام». */
export function saleLineLabel(
  shape: EntryShape,
  qty: string,
  unit: SaleUnit,
  base: number,
): string {
  if (shape.kind === "weight") {
    return base >= 1000
      ? `${Number((base / 1000).toFixed(3))} كيلو`
      : `${base} جرام`;
  }
  const count = Math.round(n(qty));
  return unit === "pack" && shape.pack
    ? `${count} ${shape.pack.one}`
    : `${count} ${shape.one}`;
}

/** «= 24 قطعة» under the total (base units, in the product's own word). */
export function saleBaseNote(shape: EntryShape, base: number): string {
  if (base <= 0) return "";
  if (shape.kind === "weight") return `= ${base} جرام`;
  const content =
    shape.content && shape.content.unit === "piece"
      ? ` (${shape.content.amount * base} قطعة جوه)`
      : "";
  return `= ${base} ${shape.one}${content}`;
}
