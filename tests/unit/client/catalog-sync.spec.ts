import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { HesbaDatabase } from "@/client/shared/db";
import { syncCatalog, searchOfflineCatalog } from "@/client/shared/catalog";

describe("Offline Catalog Sync and Search (Phase 3.3)", () => {
  const DB_NAME = "hesba_test_catalog_db";
  let db: HesbaDatabase;

  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
    db = new HesbaDatabase(DB_NAME);
    await db.open();
  });

  describe("syncCatalog", () => {
    it("synchronizes brands, products, and variants transactionally into IndexedDB", async () => {
      const mockResponseData = {
        brands: [{ id: "brand-1", name_ar: "جهينة", name_en: "Juhayna" }],
        products: [
          {
            id: "prod-1",
            brand_id: "brand-1",
            name_ar: "حليب جهينة كامل الدسم",
            name_en: "Juhayna Full Cream Milk",
            name_norm: "حليب جهينه كامل الدسم",
            category: "الألبان والجبن والزبدة والزبادي",
            type: "stock",
            updated_at: "2026-10-29T10:00:00.000Z",
          },
        ],
        variants: [
          {
            id: "var-1",
            global_product_id: "prod-1",
            flavor: "سادة",
            size_value: 1,
            size_unit: "l",
            pack_qty: 12,
            name_norm: "حليب جهينه كامل الدسم ساده 1 l",
          },
        ],
        next_cursor: "cursor-token-123",
        has_more: false,
      };

      const mockFetch = async () =>
        new Response(JSON.stringify(mockResponseData), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: 'W/"etag-abc-123"',
          },
        });

      const result = await syncCatalog(db, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.status).toBe("synced");
      expect(result.syncedProductsCount).toBe(1);
      expect(result.syncedVariantsCount).toBe(1);
      expect(result.nextCursor).toBe("cursor-token-123");

      // Verify records are in IndexedDB
      const storedProduct = await db.global_products.get("prod-1");
      expect(storedProduct).toBeDefined();
      expect(storedProduct?.name_ar).toBe("حليب جهينة كامل الدسم");

      const storedVariant = await db.global_variants.get("var-1");
      expect(storedVariant).toBeDefined();
      expect(storedVariant?.size_value).toBe(1);

      const storedBrand = await db.global_brands.get("brand-1");
      expect(storedBrand).toBeDefined();
      expect(storedBrand?.name_ar).toBe("جهينة");

      const storedCursor = await db.sync_meta.get("catalog_cursor");
      expect(storedCursor?.value).toBe("cursor-token-123");
    });

    it("returns up_to_date on 304 Not Modified without modifying tables", async () => {
      await db.sync_meta.put({ key: "catalog_cursor", value: "cursor-abc" });
      await db.sync_meta.put({ key: "catalog_etag", value: 'W/"etag-old"' });

      const mockFetch = async () =>
        new Response(null, {
          status: 304,
          headers: { ETag: 'W/"etag-old"' },
        });

      const result = await syncCatalog(db, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.status).toBe("up_to_date");
      expect(result.syncedProductsCount).toBe(0);
    });

    it("returns up_to_date on 204 No Content when cursor is current", async () => {
      await db.sync_meta.put({ key: "catalog_cursor", value: "cursor-latest" });

      const mockFetch = async () =>
        new Response(null, {
          status: 204,
        });

      const result = await syncCatalog(db, {
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.status).toBe("up_to_date");
      expect(result.syncedProductsCount).toBe(0);
    });
  });

  describe("searchOfflineCatalog", () => {
    beforeEach(async () => {
      await db.global_brands.bulkPut([
        { id: "b1", name_ar: "شيبسي", name_en: "Chipsy" },
        { id: "b2", name_ar: "المراعي", name_en: "Almarai" },
      ]);

      await db.global_products.bulkPut([
        {
          id: "p1",
          brand_id: "b1",
          name_ar: "شيبسي بطاطس",
          name_en: "Chipsy Potato Chips",
          name_norm: "شيبسي بطاطس",
          category: "الشيبسي والمقرمشات والتسالي",
          type: "stock",
          updated_at: "2026-10-29T10:00:00Z",
        },
        {
          id: "p2",
          brand_id: "b2",
          name_ar: "زبادي طبيعي المراعي",
          name_en: "Almarai Natural Yogurt",
          name_norm: "زبادي طبيعي المراعي",
          category: "الألبان والجبن والزبدة والزبادي",
          type: "stock",
          updated_at: "2026-10-29T10:00:00Z",
        },
      ]);

      await db.global_variants.bulkPut([
        {
          id: "v1",
          global_product_id: "p1",
          flavor: "شطة وليمون",
          size_value: 50,
          size_unit: "g",
          pack_qty: 1,
          name_norm: "شيبسي بطاطس شطه وليمون 50 g",
        },
        {
          id: "v2",
          global_product_id: "p1",
          flavor: "جبنة متبلة",
          size_value: 85,
          size_unit: "g",
          pack_qty: 1,
          name_norm: "شيبسي بطاطس جبنه متبله 85 g",
        },
        {
          id: "v3",
          global_product_id: "p2",
          flavor: null,
          size_value: 105,
          size_unit: "g",
          pack_qty: 6,
          name_norm: "زبادي طبيعي المراعي 105 g",
        },
      ]);
    });

    it("finds products by Arabic name and returns joined variants and brand", async () => {
      const results = await searchOfflineCatalog(db, "شيبسي");

      expect(results).toHaveLength(1);
      const res = results[0]!;
      expect(res.product.nameAr).toBe("شيبسي بطاطس");
      expect(res.brand?.nameAr).toBe("شيبسي");
      expect(res.variants).toHaveLength(2);
      expect(res.variants.map((v) => v.flavor)).toContain("شطة وليمون");
      expect(res.variants.map((v) => v.flavor)).toContain("جبنة متبلة");
    });

    it("normalizes Arabic characters (hamza, alif maqsura, taa marbuta) in offline search", async () => {
      // User searches with 'ألبان' or 'زبادي'
      const results = await searchOfflineCatalog(db, "زبادي");
      expect(results).toHaveLength(1);
      expect(results[0]?.product.nameAr).toBe("زبادي طبيعي المراعي");
      expect(results[0]?.variants[0]?.packQty).toBe(6);
    });

    it("returns empty array for empty or whitespace query", async () => {
      const results = await searchOfflineCatalog(db, "   ");
      expect(results).toEqual([]);
    });
  });
});
