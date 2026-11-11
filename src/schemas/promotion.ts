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

/** Body of `POST /api/promotions`. Re-posting an existing `id` replaces that offer. */
export const promotionSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  type: z.enum(["bundle", "single_discount"]).default("bundle"),
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string(),
      productName: z.string(),
      quantityBase: z
        .number()
        .int("الكمية لازم تكون رقم صحيح")
        .positive()
        .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي"),
      unit: z.string().default("piece"),
      regularPricePiasters: z.number().int().min(0).max(MAX_AMOUNT_PIASTERS),
    }),
  ),
  originalPricePiasters: z.number().int().positive().max(MAX_AMOUNT_PIASTERS),
  promoPricePiasters: z.number().int().positive().max(MAX_AMOUNT_PIASTERS),
  savingsPiasters: z.number().int().min(0).max(MAX_AMOUNT_PIASTERS),
  expiryDaysMin: z.number().optional(),
});

export type PromotionInput = z.infer<typeof promotionSchema>;
