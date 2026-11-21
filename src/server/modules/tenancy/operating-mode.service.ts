import "server-only";

/**
 * @file operating-mode.service.ts
 * @description Switching a shop between إدارة المحل and الكاشير الذكي (ADR-0033): the owner only,
 * this shop only, and nothing but the mode changes — no product, stock, price, person, debt,
 * purchase, expense, drawer, wallet or past sale is touched, and the trial or subscription is
 * not restarted (those fields cannot be written by the app at all: a database trigger refuses).
 */
import { prisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import type { OperatingMode } from "@/domain/operating-mode";
import { assertStoreOwner } from "./tenancy.service";

export async function setOperatingMode(
  storeId: string,
  userId: string,
  mode: OperatingMode,
): Promise<{
  operatingMode: OperatingMode;
  changed: boolean;
  changedAt: string | null;
}> {
  await assertStoreOwner(storeId, userId);
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const current = await tx.store.findFirstOrThrow({
        where: { id: storeId },
        select: { operatingMode: true, operatingModeChangedAt: true },
      });
      if (current.operatingMode === mode) {
        return {
          operatingMode: mode,
          changed: false,
          changedAt: current.operatingModeChangedAt?.toISOString() ?? null,
        };
      }
      const now = new Date();
      await tx.store.update({
        where: { id: storeId },
        data: { operatingMode: mode, operatingModeChangedAt: now },
        select: { id: true },
      });
      return {
        operatingMode: mode,
        changed: true,
        changedAt: now.toISOString(),
      };
    },
    prisma,
  );
}
