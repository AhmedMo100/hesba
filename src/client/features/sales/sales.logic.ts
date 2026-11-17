/**
 * Pure helper functions extracted from SalesView.tsx.
 * No React, no fetch, no side effects.
 */

/** Display model for a sale item tile. */
export interface DisplaySaleItem {
  id: string;
  variantId?: string;
  productId: string;
  name: string;
  sellPricePiasters: number;
  unitMode: "piece" | "weight" | "service";
  packQty: number;
  currentStockBase: number;
  status: "ok" | "low" | "out";
  isService?: boolean;
  category?: string;
  brandName?: string | null;
  unit?: string;
  packName?: string | null;
  /** A sandwich: `currentStockBase` is how many its ingredients can make. */
  isSandwich?: boolean;
  /** The product has a barcode registered (the «من غير باركود» filter and order). */
  hasBarcode?: boolean;
}

/** The sale screen's filter chips (V19). */
export type SaleFilter = "all" | "weight" | "nobc" | "svc" | "off";

/**
 * The tiles' default order: products sold by count without a barcode first, then products
 * with a barcode, then weighed products; sandwiches and services last.
 */
export function saleSortRank(item: DisplaySaleItem): number {
  if (item.isService || item.isSandwich) return 3;
  if (item.unitMode === "weight") return 2;
  return item.hasBarcode ? 1 : 0;
}

export function matchesSaleFilter(
  item: DisplaySaleItem,
  filter: SaleFilter,
): boolean {
  switch (filter) {
    case "weight":
      return item.unitMode === "weight";
    case "nobc":
      return !item.isService && !item.isSandwich && !item.hasBarcode;
    case "svc":
      return Boolean(item.isService);
    case "off":
      return false;
    default:
      return true;
  }
}

/** The tile's picture: there is no product photo, so one sign per kind of item. */
export function saleTileEmoji(item: DisplaySaleItem): string {
  if (item.isService) return "⚡";
  if (item.isSandwich) return "🥪";
  if (item.unitMode === "weight") return "⚖️";
  return "📦";
}

/**
 * UUID v4 generator that uses crypto.randomUUID() when available,
 * with a crypto.getRandomValues-based fallback for non-secure contexts (plain HTTP on LAN).
 */
export function generateUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 1
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort: Math.random (not cryptographically strong)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function formatCairoTime(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("ar-EG", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Africa/Cairo",
    });
  } catch {
    const d = new Date(ts);
    const h = d.getHours() % 12 || 12;
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = d.getHours() >= 12 ? "م" : "ص";
    return `${h}:${m} ${ampm}`;
  }
}

export function getPackLabel(
  packName?: string | null,
  packQty?: number,
): string {
  if (packName) {
    const p = packName.toLowerCase();
    if (p === "dozen" || p === "دستة" || packQty === 12) return "دستة";
    if (p === "carton" || p === "كرتونة") return "كرتونة";
    if (p === "bag" || p === "كيس") return "كيس";
    if (p === "box" || p === "علبة") return "علبة";
    return packName;
  }
  if (packQty === 12) return "دستة";
  return "كرتونة";
}

export function getUnitWord(u?: string): string {
  const val = (u || "").toLowerCase();
  if (val === "can" || val === "علبة") return "علبة";
  if (val === "jar" || val === "برطمان") return "برطمان";
  if (val === "bag" || val === "كيس") return "كيس";
  if (val === "carton" || val === "كرتونة") return "كرتونة";
  if (val && !["piece", "unit", "قطعة"].includes(val)) return val;
  return "قطعة";
}

export function formatStockText(
  item: DisplaySaleItem,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (item.isSandwich) {
    return item.currentStockBase > 0
      ? t("sandwich.canMake", { count: item.currentStockBase })
      : t("sandwich.notEnough");
  }
  if (item.isService) {
    return item.brandName ? `ماكينة ${item.brandName}` : "خدمة دفع فورية";
  }

  if (item.currentStockBase <= 0) {
    return "خلصان";
  }

  if (item.unitMode === "weight") {
    if (item.currentStockBase >= 1000) {
      const kg = Math.round((item.currentStockBase / 1000) * 10) / 10;
      return `${kg} كجم`;
    }
    return `${item.currentStockBase} جرام`;
  }

  const unitWord = getUnitWord(item.unit);
  const packQty = item.packQty || 1;
  const packLabel = getPackLabel(item.packName, item.packQty);
  if (packQty > 1) {
    const cartons = Math.floor(item.currentStockBase / packQty);
    const pieces = item.currentStockBase % packQty;
    if (cartons > 0 && pieces > 0) {
      return `${cartons} ${packLabel} و ${pieces} ${unitWord}`;
    }
    if (cartons > 0) {
      return `${cartons} ${packLabel}`;
    }
    return `${pieces} ${unitWord}`;
  }

  return `${item.currentStockBase} ${unitWord}`;
}

/** Convert a weight input (kg or grams) to integer grams. */
export function weightToGrams(value: number, unit: "kg" | "gram"): number {
  return unit === "kg" ? Math.round(value * 1000) : Math.round(value);
}

/** Format grams for display as kg or grams. */
export function formatWeightLabel(grams: number): string {
  if (grams >= 1000) {
    return `${grams / 1000} كجم`;
  }
  return `${grams} جرام`;
}

/** Compute the piasters price for a weighed sale. */
export function weightSalePiasters(
  grams: number,
  sellPricePiastersPerKg: number,
): number {
  return Math.round((grams / 1000) * sellPricePiastersPerKg);
}

/** Storage key for a store's enabled services. */
export function getServicesStorageKey(storeId?: string): string {
  return `hesba_sales_enabled_services_${storeId || "default"}`;
}

export const LEGACY_SALES_KEY_PREFIX = "hesba_sales_records";
export const STAGED_KEY = "hesba_staged_sale_item";
