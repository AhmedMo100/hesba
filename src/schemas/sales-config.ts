import { z } from "zod";

/**
 * `POST /api/sales/config` (QA-21): a PARTIAL update of the shop's sales-screen config. Only
 * the lists that are sent change; an omitted list keeps its saved value. Unknown fields, a
 * wrong type, an empty body or a non-object body are a 400 — the saved config is never reset.
 */
const idList = z
  .array(z.string().trim().min(1, "معرّف فاضي").max(100, "معرّف طويل قوي"), {
    message: "القائمة لازم تكون قائمة معرّفات",
  })
  .max(1000, "القائمة طويلة قوي");

export const salesViewConfigUpdateSchema = z
  .object({
    enabledServiceIds: idList.optional(),
    enabledProductIds: idList.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.enabledServiceIds !== undefined || v.enabledProductIds !== undefined,
    { message: "مفيش حاجة تتحفظ" },
  );

export type SalesViewConfigUpdate = z.infer<typeof salesViewConfigUpdateSchema>;
