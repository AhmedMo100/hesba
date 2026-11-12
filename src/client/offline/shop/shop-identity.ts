/**
 * @file shop-identity.ts
 * @description The signed-in shop's name (and its owner's name), kept on the device so the
 * header and the shop menu show them offline (QA-57) without a network request.
 *
 * @responsibility
 * - Saved from the session whenever it loads (`stores` row + owner name in `sync_meta`).
 * - Read for the shop this device last signed in to (`lastOutboxStore()`), never another one.
 * - Cleared when the device is online and signed out (logout, or the server refused the
 *   session), so the next person on the device does not see the previous shop.
 *
 * @usedBy `app-shell/AppShell.tsx`.
 */

import type { HesbaDatabase } from "../db";

export interface ShopIdentity {
  storeId: string;
  storeName: string;
  ownerName: string | null;
}

const ownerKey = (storeId: string) => `shop_owner:${storeId}`;

export interface ShopIdentitySource {
  user: { name: string };
  store: {
    id: string;
    name: string;
    shopType: string;
    governorate: string;
    area?: string;
    openedOn: string;
    workersCount: number;
  };
}

/** Keeps the session's shop identity on the device (idempotent; rewrites only on change). */
export async function saveShopIdentity(
  db: HesbaDatabase,
  session: ShopIdentitySource,
): Promise<void> {
  const { store, user } = session;
  const now = new Date().toISOString();
  await db.transaction("rw", db.stores, db.sync_meta, async () => {
    const existing = await db.stores.get(store.id);
    if (
      !existing ||
      existing.name !== store.name ||
      existing.shop_type !== store.shopType ||
      existing.governorate !== store.governorate ||
      (existing.area ?? null) !== (store.area ?? null) ||
      existing.workers_count !== store.workersCount
    ) {
      await db.stores.put({
        id: store.id,
        name: store.name,
        shop_type: store.shopType,
        governorate: store.governorate,
        area: store.area ?? null,
        opened_on: store.openedOn,
        workers_count: store.workersCount,
        share_custom_products: existing?.share_custom_products ?? false,
        receive_suggestions: existing?.receive_suggestions ?? false,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
    }
    const owner = await db.sync_meta.get(ownerKey(store.id));
    if (owner?.value !== user.name) {
      await db.sync_meta.put({
        key: ownerKey(store.id),
        value: user.name,
        updated_at: now,
      });
    }
  });
}

/** The saved identity of one shop, or null when this device never saw it. */
export async function loadShopIdentity(
  db: HesbaDatabase,
  storeId: string,
): Promise<ShopIdentity | null> {
  const [store, owner] = await Promise.all([
    db.stores.get(storeId),
    db.sync_meta.get(ownerKey(storeId)),
  ]);
  if (!store) return null;
  return {
    storeId,
    storeName: store.name,
    ownerName: owner?.value ?? null,
  };
}

/** Forgets every saved shop identity (signed out on this device). */
export async function forgetShopIdentities(db: HesbaDatabase): Promise<void> {
  await db.transaction("rw", db.stores, db.sync_meta, async () => {
    await db.stores.clear();
    await db.sync_meta.filter((m) => m.key.startsWith("shop_owner:")).delete();
  });
}
