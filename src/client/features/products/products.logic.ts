/**
 * Pure helper functions extracted from ProductsView.tsx.
 * No React, no CSS modules, no side effects.
 */

import type { StoreProductItem } from "@/client/shared/store-items";

/**
 * Format piasters as a compact number (pounds, no currency symbol).
 * Returns "—" for zero/negative.
 */
export function fmtMoney(piasters: number): string {
  if (!piasters || piasters <= 0) return "—";
  const val = piasters / 100;
  return (Math.round(val * 100) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

export function sandwichSubtitle(
  sandwich:
    { ingredients: { length: number }; availableCount: number } | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!sandwich) return t("sandwich.category");
  return `${t("sandwich.ingredientsCount", {
    count: sandwich.ingredients.length,
  })} · ${t("sandwich.canMake", { count: sandwich.availableCount })}`;
}

export const isWeightProduct = (p: StoreProductItem): boolean =>
  p.unit === "weight" || p.unit === "kg" || p.unit === "g";

export const packCount = (p: StoreProductItem): number => {
  if (isWeightProduct(p)) return 0;
  const n = p.variants?.[0]?.pack_qty;
  return n && n > 1 ? n : 0;
};

export function getServiceNature(p: StoreProductItem): {
  label: string;
  isStock: boolean;
} {
  if (p.category === "كروت شحن" || p.category === "كروت مرافق") {
    return { label: "كارت فيزيائي (مخزون)", isStock: true };
  }
  if (p.category === "فواتير إنترنت") {
    return { label: "دفع فاتورة رسمية", isStock: false };
  }
  if (p.category === "خدمات مرافق") {
    return { label: "شحن كارت ذكي (NFC)", isStock: false };
  }
  if (p.category === "تحويل أموال") {
    return { label: "تحويل ومحافظ نقدية", isStock: false };
  }
  if (p.category === "شحن رصيد") {
    return { label: "شحن رصيد مباشر", isStock: false };
  }
  return { label: "خدمة رقمية", isStock: false };
}
