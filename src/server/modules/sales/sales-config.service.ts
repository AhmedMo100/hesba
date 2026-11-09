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
  input: { enabledServiceIds?: unknown; enabledProductIds?: unknown },
): Promise<SalesViewConfig> {
  const toIdList = (value: unknown): string[] =>
    Array.isArray(value) ? Array.from(new Set(value.map(String))) : [];

  const config: SalesViewConfig = {
    enabledServiceIds: toIdList(input.enabledServiceIds),
    enabledProductIds: toIdList(input.enabledProductIds),
    updatedAt: new Date().toISOString(),
  };

  await updateStoreSettings(storeId, userId, () => ({
    patch: { salesConfig: config },
    result: undefined,
  }));
  return config;
}
