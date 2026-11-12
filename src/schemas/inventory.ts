import { z } from "zod";

/**
 * Damaged / lost goods (P4). A waste record says why the goods left stock without a sale:
 * - `expired`: past their expiry date;
 * - `damaged`: broken, spoiled, unusable;
 * - `missing`: lost / not found at stocktaking;
 * - `damaged_return`: a customer returned them unusable (written by the return itself);
 * - `other`: anything else (a note says what).
 */
export const WASTE_REASONS = [
  "expired",
  "damaged",
  "missing",
  "damaged_return",
  "other",
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

/** Reasons the owner records directly (a damaged return comes from the return flow). */
export const OWNER_WASTE_REASONS = [
  "expired",
  "damaged",
  "missing",
  "other",
] as const;

export const wasteReasonSchema = z.enum(OWNER_WASTE_REASONS, {
  message: "سبب التالف غير معروف",
});

export const WASTE_REASON_LABELS: Record<WasteReason, string> = {
  expired: "منتهي الصلاحية",
  damaged: "تالف",
  missing: "فاقد / ناقص",
  damaged_return: "مرتجع تالف",
  other: "سبب تاني",
};
