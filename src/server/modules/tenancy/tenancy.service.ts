import "server-only";

/**
 * @file tenancy.service.ts
 * @description Store-level concerns shared by every business module: membership/role checks
 * and the store's free-form `settings` JSON (sales-screen config, custom taxonomy, published
 * promotions, ...).
 *
 * @usedBy
 * - src/server/modules/{sales,catalog,promotions} (store settings)
 * - route handlers that check store roles
 */

import { AppError } from "@/server/platform/error";
import type { Prisma, StoreMemberRole } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";

/** The store's `settings` JSON object. Each feature owns its own top-level key. */
export type StoreSettings = Record<string, unknown>;

/** Reads the store's settings (an empty object when unset). Tenant-scoped. */
export async function readStoreSettings(
  storeId: string,
  userId: string,
): Promise<StoreSettings> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: { settings: true },
      });
      return (store?.settings as StoreSettings) || {};
    },
    prisma,
  );
}

/**
 * Read-modify-writes the store's settings in one tenant transaction.
 *
 * `update` receives the current settings and returns the top-level keys to replace (`patch`)
 * plus a value to hand back to the caller. Keys not in `patch` are preserved. The merged
 * object is JSON round-tripped, which drops `undefined` values.
 *
 * @remarks There is no row lock: two concurrent updates of the same store can lose one write.
 */
export async function updateStoreSettings<T>(
  storeId: string,
  userId: string,
  update: (current: StoreSettings) => { patch: StoreSettings; result: T },
): Promise<T> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: { settings: true },
      });
      const current = (store?.settings as StoreSettings) || {};
      const { patch, result } = update(current);
      await tx.store.update({
        where: { id: storeId },
        data: {
          settings: JSON.parse(
            JSON.stringify({ ...current, ...patch }),
          ) as Prisma.InputJsonValue,
        },
      });
      return result;
    },
    prisma,
  );
}

export async function getStoreMembership(storeId: string, userId: string) {
  return await withTenant(storeId, userId, async (tx) => {
    return await tx.storeMember.findUnique({
      where: {
        storeId_userId: {
          storeId,
          userId,
        },
      },
      include: {
        store: true,
        user: true,
      },
    });
  });
}

export async function assertStoreAccess(
  storeId: string,
  userId: string,
  allowedRoles?: StoreMemberRole[],
) {
  const member = await getStoreMembership(storeId, userId);

  if (!member) {
    throw AppError.forbidden("ليس لديك صلاحية للوصول إلى هذا المتجر");
  }

  if (allowedRoles && !allowedRoles.includes(member.role)) {
    if (allowedRoles.length === 1 && allowedRoles[0] === "owner") {
      throw AppError.forbidden("هذا الإجراء مخصص لمالك المتجر فقط");
    }
    throw AppError.forbidden(
      "ليس لديك الصلاحية الكافية في هذا المتجر لتنفيذ هذا الإجراء",
    );
  }

  return member;
}

export async function assertStoreOwner(storeId: string, userId: string) {
  return await assertStoreAccess(storeId, userId, ["owner"]);
}
