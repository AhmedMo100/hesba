import { z } from "zod";

export const productVariantInputSchema = z.object({
  id: z.string().uuid().optional(),
  flavor: z.string().trim().nullable().optional(),
  sizeValue: z.number().positive().nullable().optional(),
  sizeUnit: z.enum(["g", "kg", "ml", "l", "piece"]).nullable().optional(),
  packQty: z.number().int().positive().default(1),
  sellPricePiasters: z.number().int().min(0, "سعر البيع يجب ألا يقل عن صفر"),
  globalVariantId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().default(true),
});

export type ProductVariantInput = z.infer<typeof productVariantInputSchema>;

export const upsertProductInputSchema = z.object({
  id: z.string().uuid().optional(),
  opId: z.string().uuid().optional(),
  nameAr: z.string().trim().min(2, "اسم المنتج مطلوب (حرفين على الأقل)"),
  category: z.string().trim().min(2, "التصنيف مطلوب"),
  unit: z.enum(["piece", "kg", "g", "ml", "l"]).default("piece"),
  sellPricePiasters: z.number().int().min(0, "سعر البيع الأساسي مطلوب"),
  isCustom: z.boolean().default(true),
  globalProductId: z.string().uuid().nullable().optional(),
  brandName: z.string().trim().nullable().optional(),
  variants: z
    .array(productVariantInputSchema)
    .min(1, "يجب تحديد نسخة واحدة على الأقل للمنتج"),
});

export type UpsertProductInput = z.infer<typeof upsertProductInputSchema>;
