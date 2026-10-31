import { type HesbaDatabase } from "../db";
import type {
  LocalGlobalBrand,
  LocalGlobalProduct,
  LocalGlobalVariant,
} from "../db/types";

export interface CatalogSyncResult {
  syncedProductsCount: number;
  syncedVariantsCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  status: "synced" | "up_to_date" | "error";
  error?: string;
}

interface CatalogSyncResponse {
  brands: LocalGlobalBrand[];
  products: LocalGlobalProduct[];
  variants: LocalGlobalVariant[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Synchronizes the public global catalog from the server into IndexedDB.
 * Works incrementally using cursor and ETag.
 * Guaranteed transactional storage: interrupted sync cannot leave partial/inconsistent state.
 */
export async function syncCatalog(
  db: HesbaDatabase,
  options?: { endpoint?: string; fetchFn?: typeof fetch },
): Promise<CatalogSyncResult> {
  const endpoint = options?.endpoint ?? "/api/sync/catalog";
  const fetcher = options?.fetchFn ?? fetch;

  try {
    const metaCursor = await db.sync_meta.get("catalog_cursor");
    const metaEtag = await db.sync_meta.get("catalog_etag");

    const cursor = metaCursor?.value ?? "";
    const etag = metaEtag?.value ?? "";

    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost:3000";
    const url = new URL(endpoint, base);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    url.searchParams.set("limit", "500");

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (etag) {
      headers["If-None-Match"] = etag;
    }

    const response = await fetcher(url.toString(), {
      method: "GET",
      headers,
    });

    // 304 Not Modified or 204 No Content
    if (response.status === 304 || response.status === 204) {
      return {
        syncedProductsCount: 0,
        syncedVariantsCount: 0,
        hasMore: false,
        nextCursor: cursor || null,
        status: "up_to_date",
      };
    }

    if (!response.ok) {
      // If cursor was invalid / expired, reset cursor and retry once
      if (response.status === 400 && cursor) {
        await db.sync_meta.delete("catalog_cursor");
        await db.sync_meta.delete("catalog_etag");
        return syncCatalog(db, options);
      }
      return {
        syncedProductsCount: 0,
        syncedVariantsCount: 0,
        hasMore: false,
        nextCursor: null,
        status: "error",
        error: `Server returned status ${response.status}`,
      };
    }

    const newEtag = response.headers.get("ETag") ?? "";
    const data = (await response.json()) as CatalogSyncResponse;

    const products = data.products ?? [];
    const variants = data.variants ?? [];
    const brands = data.brands ?? [];
    const nextCursor = data.next_cursor ?? null;
    const hasMore = Boolean(data.has_more);

    // Transactionally update local Dexie tables
    await db.transaction(
      "rw",
      [db.global_brands, db.global_products, db.global_variants, db.sync_meta],
      async () => {
        if (brands.length > 0) {
          await db.global_brands.bulkPut(brands);
        }
        if (products.length > 0) {
          await db.global_products.bulkPut(products);
        }
        if (variants.length > 0) {
          await db.global_variants.bulkPut(variants);
        }

        if (nextCursor) {
          await db.sync_meta.put({
            key: "catalog_cursor",
            value: nextCursor,
            updated_at: new Date().toISOString(),
          });
        }
        if (newEtag) {
          await db.sync_meta.put({
            key: "catalog_etag",
            value: newEtag,
            updated_at: new Date().toISOString(),
          });
        }
      },
    );

    return {
      syncedProductsCount: products.length,
      syncedVariantsCount: variants.length,
      hasMore,
      nextCursor,
      status: "synced",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Sync error";
    return {
      syncedProductsCount: 0,
      syncedVariantsCount: 0,
      hasMore: false,
      nextCursor: null,
      status: "error",
      error: message,
    };
  }
}
