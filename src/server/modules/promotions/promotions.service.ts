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
import type { PromotionInput, PublishedPromotion } from "@/schemas/promotion";

function promotionsIn(settings: StoreSettings): PublishedPromotion[] {
  return Array.isArray(settings.activePromotions)
    ? (settings.activePromotions as PublishedPromotion[])
    : [];
}

/** Returns the store's published offers, newest first. */
export async function listPromotions(
  storeId: string,
  userId: string,
): Promise<PublishedPromotion[]> {
  return promotionsIn(await readStoreSettings(storeId, userId));
}

/**
 * Publishes an offer at the top of the list. An existing offer with the same id is replaced,
 * so editing an offer is a re-publish.
 */
export async function publishPromotion(
  storeId: string,
  userId: string,
  input: PromotionInput,
): Promise<PublishedPromotion> {
  const promotion: PublishedPromotion = { ...input, createdAt: Date.now() };
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
