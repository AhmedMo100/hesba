import "server-only";

/**
 * @file sales-config.service.ts
 * @description Which services and products the store pins to its sales screen, stored under
 * `stores.settings.salesConfig`. Extracted unchanged from `src/app/api/sales/config/route.ts`.
 *
 * @usedBy
 * - src/app/api/sales/config/route.ts
 */

import {
  readStoreSettings,
  updateStoreSettings,
} from "@/server/modules/tenancy";
import type { SalesViewConfigUpdate } from "@/schemas/sales-config";

export interface SalesViewConfig {
  enabledServiceIds: string[];
  enabledProductIds?: string[];
  updatedAt?: string;
}

/** Returns the saved sales-screen config, or empty lists when none was saved. */
export async function getSalesViewConfig(
  storeId: string,
  userId: string,
): Promise<SalesViewConfig> {
  const settings = await readStoreSettings(storeId, userId);
  return (
    (settings.salesConfig as SalesViewConfig | undefined) || {
      enabledServiceIds: [],
      enabledProductIds: [],
    }
  );
}

/**
 * Replaces the sales-screen config. Ids are coerced to strings and de-duplicated; a
 * non-array value is stored as an empty list.
 */
export async function saveSalesViewConfig(
  storeId: string,
  userId: string,
  input: SalesViewConfigUpdate,
): Promise<SalesViewConfig> {
  const unique = (ids: string[]) => Array.from(new Set(ids));
  return updateStoreSettings(storeId, userId, (settings) => {
    const saved = (settings.salesConfig as SalesViewConfig | undefined) ?? {
      enabledServiceIds: [],
      enabledProductIds: [],
    };
    // Partial update (QA-21): a list that was not sent keeps its saved value.
    const config: SalesViewConfig = {
      enabledServiceIds:
        input.enabledServiceIds !== undefined
          ? unique(input.enabledServiceIds)
          : (saved.enabledServiceIds ?? []),
      enabledProductIds:
        input.enabledProductIds !== undefined
          ? unique(input.enabledProductIds)
          : (saved.enabledProductIds ?? []),
      updatedAt: new Date().toISOString(),
    };
    return { patch: { salesConfig: config }, result: config };
  });
}
