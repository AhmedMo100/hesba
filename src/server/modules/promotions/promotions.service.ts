import "server-only";

/**
 * @file promotions.service.ts
 * @description Reads and edits the store's published offers, which are stored as a JSON array
 * under `stores.settings.activePromotions` (there is no promotions table).
 *
 * Extracted unchanged from `src/app/api/promotions/route.ts` (ADR-0017). Behavior is pinned by
 * `tests/integration/promotions-api.spec.ts`.
 *
 * @usedBy
 * - src/app/api/promotions/route.ts
 *
 * @remarks Settings writes have no row lock (see `updateStoreSettings`), so two concurrent
 * publishes for the same store can lose one update.
 */

import {
  readStoreSettings,
  updateStoreSettings,
  type StoreSettings,
} from "@/server/modules/tenancy";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { saleLineTotalPiasters } from "@/domain/sale-pricing";
import type {
  PromotionInput,
  PublishedPromotion,
  PublishedPromotionItem,
} from "@/schemas/promotion";

function promotionsIn(settings: StoreSettings): PublishedPromotion[] {
  return Array.isArray(settings.activePromotions)
    ? (settings.activePromotions as PublishedPromotion[])
    : [];
}

/**
 * Reads one published offer inside the caller's tenant transaction (used by the promotion
 * sale, ADR-0019, so the sale is priced from the offer the shop saved, not from the client).
 * Returns null when the store has no offer with that id.
 */
export async function findPromotionInTx(
  tx: TenantTx,
  storeId: string,
  promotionId: string,
): Promise<PublishedPromotion | null> {
  const store = await tx.store.findUnique({
    where: { id: storeId },
    select: { settings: true },
  });
  const settings = (store?.settings as StoreSettings | null) ?? {};
  return promotionsIn(settings).find((p) => p.id === promotionId) ?? null;
}

/** Returns the store's published offers, newest first. */
export async function listPromotions(
  storeId: string,
  userId: string,
): Promise<PublishedPromotion[]> {
  return promotionsIn(await readStoreSettings(storeId, userId));
}

/**
 * Checks every item of an offer against the shop's own products (QA-20) and prices it the
 * way the sale will (`saleLineTotalPiasters`): the item's regular price is the registered
 * price of that quantity, the original total is their sum, and the savings follow from it.
 * The client's names and prices are replaced by the shop's.
 *
 * @throws AppError 400 when an item is not an active product of this shop, has no price, or
 *   the offer price is not below the original.
 */
async function resolvePromotionItems(
  storeId: string,
  userId: string,
  input: PromotionInput,
): Promise<{ items: PublishedPromotionItem[]; originalPricePiasters: number }> {
  return withTenant(storeId, userId, async (tx) => {
    const items: PublishedPromotionItem[] = [];
    for (const item of input.items) {
      const variant = await tx.storeVariant.findFirst({
        where: { id: item.variantId, storeId, isActive: true },
        select: {
          id: true,
          sellPricePiasters: true,
          storeProduct: {
            select: {
              id: true,
              nameAr: true,
              unit: true,
              isActive: true,
              sellPricePiasters: true,
            },
          },
        },
      });
      const product = variant?.storeProduct;
      if (!variant || !product || !product.isActive) {
        throw AppError.badRequest(
          `«${item.productName || "منتج"}» من العرض مش موجود في محلك`,
        );
      }
      const unitPrice = Number(
        variant.sellPricePiasters > BigInt(0)
          ? variant.sellPricePiasters
          : product.sellPricePiasters,
      );
      const regular = saleLineTotalPiasters(
        product.unit,
        unitPrice,
        item.quantityBase,
      );
      if (regular <= 0) {
        throw AppError.badRequest(
          `«${product.nameAr ?? item.productName}» مالوش سعر بيع، سعّره الأول`,
        );
      }
      items.push({
        productId: product.id,
        variantId: variant.id,
        productName: product.nameAr ?? item.productName,
        quantityBase: item.quantityBase,
        unit: product.unit,
        regularPricePiasters: regular,
      });
    }
    const originalPricePiasters = items.reduce(
      (sum, i) => sum + i.regularPricePiasters,
      0,
    );
    return { items, originalPricePiasters };
  });
}

/**
 * Publishes an offer at the top of the list. An existing offer with the same id is replaced,
 * so editing an offer is a re-publish. The items and prices are checked and recomputed by
 * the server first (`resolvePromotionItems`, QA-20).
 */
export async function publishPromotion(
  storeId: string,
  userId: string,
  input: PromotionInput,
): Promise<PublishedPromotion> {
  const { items, originalPricePiasters } = await resolvePromotionItems(
    storeId,
    userId,
    input,
  );
  if (input.promoPricePiasters >= originalPricePiasters) {
    throw AppError.badRequest("سعر العرض لازم يكون أقل من السعر الأصلي", {
      originalPricePiasters,
    });
  }
  const promotion: PublishedPromotion = {
    ...input,
    items,
    originalPricePiasters,
    savingsPiasters: originalPricePiasters - input.promoPricePiasters,
    createdAt: Date.now(),
  };
  await updateStoreSettings(storeId, userId, (settings) => ({
    patch: {
      activePromotions: [
        promotion,
        ...promotionsIn(settings).filter((p) => p.id !== promotion.id),
      ],
    },
    result: undefined,
  }));
  return promotion;
}

/** Removes one offer. Removing an unknown id is a no-op. */
export async function removePromotion(
  storeId: string,
  userId: string,
  promotionId: string,
): Promise<void> {
  await updateStoreSettings(storeId, userId, (settings) => ({
    patch: {
      activePromotions: promotionsIn(settings).filter(
        (p) => p.id !== promotionId,
      ),
    },
    result: undefined,
  }));
}
