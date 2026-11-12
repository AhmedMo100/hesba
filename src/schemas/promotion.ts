import { z } from "zod";
import { MAX_AMOUNT_PIASTERS, MAX_QUANTITY_BASE } from "@/domain/limits";

/** One product line inside a published offer. Prices in integer piasters. */
export interface PublishedPromotionItem {
  productId: string;
  variantId: string;
  productName: string;
  quantityBase: number;
  unit: string;
  regularPricePiasters: number;
}

/**
 * An offer the owner approved and published (from Alerts near-expiry suggestions or
 * the sales screen). Stored per store in `stores.settings.activePromotions`.
 */
export interface PublishedPromotion {
  id: string;
  title: string;
  description?: string;
  type?: "bundle" | "single_discount";
  items: PublishedPromotionItem[];
  originalPricePiasters: number;
  promoPricePiasters: number;
  savingsPiasters: number;
  expiryDaysMin?: number;
  /** Epoch milliseconds, set by the server when published. */
  createdAt: number;
}

/**
 * Body of `POST /api/promotions`. Re-posting an existing `id` replaces that offer.
 *
 * QA-20: an offer must have at least one item (exactly one for a single discount), and its
 * price must be below the original. The server then checks every item against the shop's own
 * products and recomputes the item prices, the original total and the savings from them
 * (`publishPromotion`); the client's prices are not trusted.
 */
export const promotionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[\w-]+$/, "رقم العرض غير صحيح"),
    title: z.string().trim().min(1, "اكتب اسم العرض").max(200),
    description: z.string().trim().max(1000).optional(),
    type: z.enum(["bundle", "single_discount"]).default("bundle"),
    items: z
      .array(
        z.object({
          productId: z.string().max(100),
          variantId: z.string().uuid("منتج العرض غير صحيح"),
          productName: z.string().max(300),
          quantityBase: z
            .number()
            .int("الكمية لازم تكون رقم صحيح")
            .positive()
            .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي"),
          unit: z.string().default("piece"),
          regularPricePiasters: z
            .number()
            .int()
            .min(0)
            .max(MAX_AMOUNT_PIASTERS),
        }),
      )
      .min(1, "العرض لازم يكون فيه منتج واحد على الأقل")
      .max(50, "منتجات العرض كتير قوي"),
    originalPricePiasters: z.number().int().positive().max(MAX_AMOUNT_PIASTERS),
    promoPricePiasters: z
      .number()
      .int("سعر العرض لازم يكون بالقروش (رقم صحيح)")
      .positive("سعر العرض لازم يكون أكبر من صفر")
      .max(MAX_AMOUNT_PIASTERS),
    savingsPiasters: z.number().int().min(0).max(MAX_AMOUNT_PIASTERS),
    expiryDaysMin: z.number().int().min(0).max(3650).optional(),
  })
  .refine((p) => p.type !== "single_discount" || p.items.length === 1, {
    message: "الخصم على منتج واحد بس",
    path: ["items"],
  })
  .refine((p) => p.promoPricePiasters < p.originalPricePiasters, {
    message: "سعر العرض لازم يكون أقل من السعر الأصلي",
    path: ["promoPricePiasters"],
  });

export type PromotionInput = z.infer<typeof promotionSchema>;
