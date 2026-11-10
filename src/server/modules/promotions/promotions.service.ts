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
import type { TenantTx } from "@/server/infra/db/tenant";
import type { PromotionInput, PublishedPromotion } from "@/schemas/promotion";

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
