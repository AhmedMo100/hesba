import { z } from "zod";

/**
 * Damaged / lost goods (P4; the owner's reasons since 2026-11-26). A waste record says why the
 * goods left stock without a sale. The owner records:
 * - `expired` منتهي الصلاحية · `near_expiry` قرب انتهاء الصلاحية;
 * - `storage_damage` تلف أثناء التخزين · `broken_leak` كسر أو تسريب · `poor_storage` سوء تخزين;
 * - `supplier_damage` تالف من المورد;
 * - `other` سبب آخر (its description is required, in the note).
 * Kept for the stocktake, returns and history: `damaged`, `missing`, `damaged_return`.
 */
export const WASTE_REASONS = [
  "expired",
  "near_expiry",
  "storage_damage",
  "broken_leak",
  "poor_storage",
  "supplier_damage",
  "other",
  "damaged",
  "missing",
  "damaged_return",
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

/** The reasons offered to the owner, in this order. */
export const OWNER_WASTE_REASONS = [
  "expired",
  "near_expiry",
  "storage_damage",
  "broken_leak",
  "poor_storage",
  "supplier_damage",
  "other",
] as const;

/** Accepted from the owner: the offered reasons, plus the older `damaged` / `missing`. */
export const wasteReasonSchema = z.enum(
  [...OWNER_WASTE_REASONS, "damaged", "missing"],
  { message: "سبب التالف غير معروف" },
);

export const WASTE_REASON_LABELS: Record<WasteReason, string> = {
  expired: "منتهي الصلاحية",
  near_expiry: "قرب انتهاء الصلاحية",
  storage_damage: "تلف أثناء التخزين",
  broken_leak: "كسر أو تسريب",
  poor_storage: "سوء تخزين",
  supplier_damage: "تالف من المورد",
  other: "سبب آخر",
  damaged: "تالف",
  missing: "فاقد / ناقص",
  damaged_return: "مرتجع تالف",
};

/** Where a waste record was made (the log shows it). */
export const WASTE_SOURCES = [
  "alerts",
  "products",
  "stock",
  "stocktake",
  "return",
] as const;
export type WasteSource = (typeof WASTE_SOURCES)[number];
export const WASTE_SOURCE_LABELS: Record<WasteSource, string> = {
  alerts: "التنبيهات",
  products: "بضاعتي",
  stock: "دخلت بضاعة",
  stocktake: "الجرد",
  return: "مرتجع",
};
