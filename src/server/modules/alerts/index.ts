import "server-only";

import { prisma } from "@/server/infra/db/client";
import { InventoryService } from "@/server/modules/inventory";
import { buildStoreAlerts, type StoreAlerts } from "@/domain/alerts";

/**
 * Computes the Alerts screen for one store: reads its inventory (tenant-scoped through
 * `InventoryService`) and applies the pure rules in `src/domain/alerts.ts`.
 *
 * The module is a single function, so it lives in its index file rather than a separate
 * service file.
 */
export async function getStoreAlerts(
  storeId: string,
  userId: string,
): Promise<StoreAlerts> {
  const inventory = await new InventoryService(prisma).getStoreInventory(
    storeId,
    userId,
  );
  return buildStoreAlerts(inventory);
}
