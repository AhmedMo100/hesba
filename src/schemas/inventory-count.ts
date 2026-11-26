import { z } from "zod";

/** Quantities are base units (pieces, or grams for weighed goods), as everywhere in stock. */
const baseQty = z
  .number({ message: "الكمية غير صحيحة" })
  .int("الكمية لازم تكون رقم صحيح")
  .min(0, "الكمية مينفعش تبقى سالبة")
  .max(1_000_000_000, "الكمية كبيرة قوي");

export const COUNT_REASONS = [
  "unrecorded_sale",
  "damaged",
  "expired",
  "lost",
  "unknown",
  "surplus",
] as const;
export type CountReason = (typeof COUNT_REASONS)[number];

/** «اعمل جرد جديد»: the whole shop, one category, or chosen products. */
export const startInventoryCountSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    scope: z.enum(["full", "category", "selected"], {
      message: "اختار نوع الجرد",
    }),
    category: z.string().trim().min(1).max(80).optional().nullable(),
    variantIds: z.array(z.string().uuid()).max(2000).optional(),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict()
  .refine((v) => v.scope !== "category" || !!v.category, {
    message: "اختار القسم اللي هتجرده",
    path: ["category"],
  })
  .refine((v) => v.scope !== "selected" || (v.variantIds?.length ?? 0) > 0, {
    message: "اختار صنف واحد على الأقل",
    path: ["variantIds"],
  });
export type StartInventoryCountInput = z.infer<
  typeof startInventoryCountSchema
>;

/** Counted quantities (and the owner's explanation of each difference) while the count is open. */
export const updateInventoryCountSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            variantId: z.string().uuid("الصنف غير صحيح"),
            /** null = clear the count (the line is left out at confirmation). */
            countedBase: baseQty.nullable(),
            reason: z.enum(COUNT_REASONS).optional().nullable(),
            /** The owner's note on the difference («اتكسر في النقل»); undefined = keep it. */
            note: z
              .string()
              .trim()
              .max(300, "الملاحظة طويلة قوي")
              .optional()
              .nullable(),
          })
          .strict()
          // «سبب آخر» (`unknown`, chosen by the owner) is explained in his own words (2026-11-26).
          .refine((l) => l.reason !== "unknown" || !!l.note?.trim(), {
            message: "اكتب السبب",
            path: ["note"],
          }),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type UpdateInventoryCountInput = z.infer<
  typeof updateInventoryCountSchema
>;

export const confirmInventoryCountSchema = z
  .object({ opId: z.string().uuid("رقم العملية غير صحيح") })
  .strict();

/**
 * `GET /api/inventory-counts/:id/lines` — one page of a count's lines, for the counting screen
 * (ADR-0039): by barcode (the scanner), by name (the search), by product, or by state (not
 * counted yet / counted / with a difference). Never the whole count at once.
 */
export const countLinesQuerySchema = z
  .object({
    status: z.enum(["all", "pending", "counted", "diff"]).default("all"),
    q: z.string().trim().min(1).max(80).optional(),
    barcode: z.string().trim().min(1).max(64).optional(),
    variantId: z.string().uuid("الصنف غير صحيح").optional(),
    cursor: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();
export type CountLinesQuery = z.infer<typeof countLinesQuerySchema>;
