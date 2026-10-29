import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { CatalogService } from "@/server/modules/catalog";
import { createSession } from "@/server/modules/auth/session.service";
import {
  GET as getProductsRoute,
  POST as postProductsRoute,
} from "@/app/api/products/route";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("Products API & Service (Phase 3.4 Integration)", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;
  const runId = Math.random().toString(36).slice(2, 8);

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: {
      name: string;
      shopType: string;
      governorate: string;
      shareCustomProducts?: boolean;
      receiveSuggestions?: boolean;
    },
  ) {
    return await withTenant(
      id,
      creatorId,
      async (tx) => {
        const store = await tx.store.create({
          data: {
            id,
            name: data.name,
            shopType: data.shopType,
            governorate: data.governorate,
            shareCustomProducts: data.shareCustomProducts ?? true,
            receiveSuggestions: data.receiveSuggestions ?? true,
            createdBy: creatorId,
          },
        });

        await tx.storeMember.create({
          data: {
            storeId: id,
            userId: creatorId,
            role: "owner",
          },
        });

        return store;
      },
      migratorPrisma,
    );
  }

  beforeAll(async () => {
    migratorClient = postgres(directUrl, { max: 1 });
    migratorPrisma = new PrismaClient({
      datasources: { db: { url: directUrl } },
    });
    appPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });

    await migratorPrisma.$connect();
    await appPrisma.$connect();

    userAId = crypto.randomUUID();
    userBId = crypto.randomUUID();
    storeAId = crypto.randomUUID();
    storeBId = crypto.randomUUID();

    // Create test users first
    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `تاجر أ ${runId}`,
          phone: `+20108${runId}`,
          email: `owner-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `تاجر ب ${runId}`,
          phone: `+20109${runId}`,
          email: `owner-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    // Create test stores with withTenant
    await createStoreWithRLS(storeAId, userAId, {
      name: `محل منتجات أ ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
      shareCustomProducts: true,
      receiveSuggestions: true,
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `محل منتجات ب ${runId}`,
      shopType: "kiosk",
      governorate: "Giza",
      shareCustomProducts: false,
      receiveSuggestions: false,
    });
  });

  afterAll(async () => {
    if (storeAId && storeBId) {
      await migratorClient.unsafe(`
        ALTER TABLE store_variants DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products DISABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_notifications DISABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_suggestions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE candidate_adoptions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_reports DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stores DISABLE ROW LEVEL SECURITY;

        DELETE FROM store_variants WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_products WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM catalog_notifications WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM catalog_suggestions WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM candidate_adoptions WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM catalog_reports WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_members WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stores WHERE id IN ('${storeAId}', '${storeBId}');

        ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_reports ENABLE ROW LEVEL SECURITY;
        ALTER TABLE candidate_adoptions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_suggestions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE catalog_notifications ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants ENABLE ROW LEVEL SECURITY;
      `);
      await migratorClient`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    }

    await migratorPrisma.$disconnect();
    await appPrisma.$disconnect();
    await migratorClient.end();
  });

  it("creates a store product with variant under store tenant and submits custom candidate", async () => {
    const catalogService = new CatalogService(appPrisma);

    const result = await catalogService.upsertStoreProduct(storeAId, userAId, {
      nameAr: `شاي مميز ${runId}`,
      category: "المشروبات الساخنة والقهوة والشاي",
      unit: "piece",
      sellPricePiasters: 1550, // 15.50 EGP
      isCustom: true,
      variants: [
        {
          flavor: "قرنفل",
          sizeValue: 250,
          sizeUnit: "g",
          packQty: 1,
          sellPricePiasters: 1550,
        },
      ],
    });

    expect(result.storeProductId).toBeDefined();
    expect(result.variants).toHaveLength(1);
    expect(result.candidateId).toBeDefined();

    // Verify stored data in DB
    const products = await catalogService.getStoreProducts(storeAId, userAId);
    expect(products.length).toBeGreaterThanOrEqual(1);

    const created = products.find((p) => p.id === result.storeProductId);
    expect(created).toBeDefined();
    expect(created?.nameAr).toBe(`شاي مميز ${runId}`);
    expect(created?.nameNorm).toBeDefined();
    expect(Number(created?.sellPricePiasters)).toBe(1550);
    expect(created?.storeVariants).toHaveLength(1);
    expect(created?.storeVariants[0]?.flavor).toBe("قرنفل");
    expect(Number(created?.storeVariants[0]?.sellPricePiasters)).toBe(1550);
  });

  it("strictly enforces tenant isolation: Store B cannot see or modify Store A products", async () => {
    const catalogService = new CatalogService(appPrisma);

    // Create product in Store A
    const prodA = await catalogService.upsertStoreProduct(storeAId, userAId, {
      nameAr: `جبنة اسطنبولي ${runId}`,
      category: "الجبن والألبان والزبادي",
      unit: "kg",
      sellPricePiasters: 12000,
      isCustom: true,
      variants: [
        {
          sizeUnit: "kg",
          sellPricePiasters: 12000,
        },
      ],
    });

    // Query from Store B
    const storeBProducts = await catalogService.getStoreProducts(
      storeBId,
      userBId,
    );
    const leaked = storeBProducts.find((p) => p.id === prodA.storeProductId);
    expect(leaked).toBeUndefined();

    // Store B attempts to update Store A's product -> must throw
    await expect(
      catalogService.upsertStoreProduct(storeBId, userBId, {
        id: prodA.storeProductId,
        nameAr: "محاولة اختراق",
        category: "الجبن",
        unit: "piece",
        sellPricePiasters: 100,
        variants: [{ sellPricePiasters: 100 }],
      }),
    ).rejects.toThrow();

    // Store B attempts to delete Store A's product -> must throw
    await expect(
      catalogService.deleteStoreProduct(
        storeBId,
        userBId,
        prodA.storeProductId,
      ),
    ).rejects.toThrow();
  });

  it("updates an existing store product and variant successfully", async () => {
    const catalogService = new CatalogService(appPrisma);

    // Create product
    const created = await catalogService.upsertStoreProduct(storeAId, userAId, {
      nameAr: `سكر أبيض ${runId}`,
      category: "السلع الاستهلاكية",
      unit: "piece",
      sellPricePiasters: 3000,
      isCustom: true,
      variants: [
        {
          sizeValue: 1,
          sizeUnit: "kg",
          sellPricePiasters: 3000,
        },
      ],
    });

    const variantId = created.variants[0]?.id;
    expect(variantId).toBeDefined();

    // Update product price and name
    await catalogService.upsertStoreProduct(storeAId, userAId, {
      id: created.storeProductId,
      nameAr: `سكر أبيض ممتاز ${runId}`,
      category: "السلع الاستهلاكية",
      unit: "piece",
      sellPricePiasters: 3500,
      variants: [
        {
          id: variantId,
          sizeValue: 1,
          sizeUnit: "kg",
          sellPricePiasters: 3500,
        },
      ],
    });

    // Fetch and assert updated values
    const products = await catalogService.getStoreProducts(storeAId, userAId);
    const updated = products.find((p) => p.id === created.storeProductId);
    expect(updated?.nameAr).toBe(`سكر أبيض ممتاز ${runId}`);
    expect(Number(updated?.sellPricePiasters)).toBe(3500);
    expect(Number(updated?.storeVariants[0]?.sellPricePiasters)).toBe(3500);
  });

  it("deactivates store product and its variants when deleted", async () => {
    const catalogService = new CatalogService(appPrisma);

    const created = await catalogService.upsertStoreProduct(storeAId, userAId, {
      nameAr: `منتج مؤقت للحذف ${runId}`,
      category: "عام",
      unit: "piece",
      sellPricePiasters: 500,
      variants: [{ sellPricePiasters: 500 }],
    });

    // Delete product
    const deleteRes = await catalogService.deleteStoreProduct(
      storeAId,
      userAId,
      created.storeProductId,
    );
    expect(deleteRes.success).toBe(true);

    // Verify it is no longer returned in active products
    const activeProducts = await catalogService.getStoreProducts(
      storeAId,
      userAId,
    );
    const found = activeProducts.find((p) => p.id === created.storeProductId);
    expect(found).toBeUndefined();
  });

  it("POST /api/products creates product, safely serializes JSON (no BigInt 500 error), and saves in PostgreSQL", async () => {
    const sessionA = await createSession(userAId, storeAId);

    const payload = {
      nameAr: `شاي ليبتون ناعم ${runId}`,
      category: "مشروبات",
      unit: "piece" as const,
      sellPricePiasters: 4500,
      isCustom: true,
      variants: [
        {
          flavor: "شاي أسود",
          sizeValue: 250,
          sizeUnit: "g" as const,
          packQty: 1,
          sellPricePiasters: 4500,
        },
      ],
    };

    const req = new Request("http://localhost:3000/api/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify(payload),
    });

    const res = await postProductsRoute(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.name_ar).toBe(`شاي ليبتون ناعم ${runId}`);
    expect(typeof json.data.sell_price_piasters).toBe("number");
    expect(json.data.sell_price_piasters).toBe(4500);
    expect(json.data.variants.length).toBe(1);
    expect(typeof json.data.variants[0].sell_price_piasters).toBe("number");
    expect(json.data.variants[0].sell_price_piasters).toBe(4500);

    const productId = json.data.id;
    expect(productId).toBeDefined();

    // Verify it is physically in PostgreSQL for Store A
    const stored = await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        return await tx.storeProduct.findUnique({
          where: { id: productId },
          include: { storeVariants: true },
        });
      },
      appPrisma,
    );

    expect(stored).not.toBeNull();
    expect(stored?.nameAr).toBe(`شاي ليبتون ناعم ${runId}`);
    expect(Number(stored?.sellPricePiasters)).toBe(4500);
    expect(stored?.storeVariants[0]?.flavor).toBe("شاي أسود");

    // Test GET /api/products for Store A returns this product
    const getReqA = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const getResA = await getProductsRoute(getReqA);
    expect(getResA.status).toBe(200);
    const getJsonA = await getResA.json();
    interface ApiProductItem {
      id: string;
      name_ar: string;
    }
    const itemA = (getJsonA.products as ApiProductItem[]).find(
      (p) => p.id === productId,
    );
    expect(itemA).toBeDefined();
    expect(itemA?.name_ar).toBe(`شاي ليبتون ناعم ${runId}`);

    // Test GET /api/products for Store B strictly does NOT return Store A's product (cross-tenant check)
    const sessionB = await createSession(userBId, storeBId);
    const getReqB = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionB.rawToken}` },
    });
    const getResB = await getProductsRoute(getReqB);
    expect(getResB.status).toBe(200);
    const getJsonB = await getResB.json();
    const leakedItem = (getJsonB.products as ApiProductItem[]).find(
      (p) => p.id === productId,
    );
    expect(leakedItem).toBeUndefined();
  });
});
