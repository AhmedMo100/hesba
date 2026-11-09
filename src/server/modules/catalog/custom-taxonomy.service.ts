import "server-only";

/**
 * @file custom-taxonomy.service.ts
 * @description A store's own product categories and selling methods (beyond the standard
 * lists), stored under `stores.settings.customCategories` / `customSellingMethods`.
 * Extracted unchanged from `src/app/api/store/custom-taxonomy/route.ts`.
 *
 * @usedBy
 * - src/app/api/store/custom-taxonomy/route.ts
 */

import {
  readStoreSettings,
  updateStoreSettings,
  type StoreSettings,
} from "@/server/modules/tenancy";
import type { CustomTaxonomyInput } from "@/schemas/product";

/** The placeholder "Other" option in the pickers — never stored as a real value. */
const OTHER_OPTION = "أخرى";

export interface CustomTaxonomy {
  customCategories: string[];
  customSellingMethods: string[];
}

function taxonomyIn(settings: StoreSettings): CustomTaxonomy {
  return {
    customCategories: Array.isArray(settings.customCategories)
      ? [...(settings.customCategories as string[])]
      : [],
    customSellingMethods: Array.isArray(settings.customSellingMethods)
      ? [...(settings.customSellingMethods as string[])]
      : [],
  };
}

function addValue(list: string[], value: string | undefined) {
  if (!value || value === OTHER_OPTION) return;
  const trimmed = value.trim();
  if (trimmed && !list.includes(trimmed)) list.push(trimmed);
}

export async function getCustomTaxonomy(
  storeId: string,
  userId: string,
): Promise<CustomTaxonomy> {
  return taxonomyIn(await readStoreSettings(storeId, userId));
}

/** Appends new values (trimmed, once each) and returns the updated lists. */
export async function addCustomTaxonomy(
  storeId: string,
  userId: string,
  input: CustomTaxonomyInput,
): Promise<CustomTaxonomy> {
  return updateStoreSettings(storeId, userId, (settings) => {
    const taxonomy = taxonomyIn(settings);
    addValue(taxonomy.customCategories, input.newCategory);
    addValue(taxonomy.customSellingMethods, input.newSellingMethod);
    return { patch: { ...taxonomy }, result: taxonomy };
  });
}
