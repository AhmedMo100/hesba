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
  // Fixtures only (seed, inspect, clean up): a test-database admin connection. The migrator
  // no longer sees shops' rows (ADR-0024); isolation itself is tested through the app role.
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";
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

  it("creates initial stock batch on creation and protects stock from direct edit overwrite", async () => {
    const sessionA = await createSession(userAId, storeAId);

    // 1. Create product with buy cost and initial stock
    const payload = {
      nameAr: `زيت ذرة كريستال ${runId}`,
      category: "زيوت وسمن",
      unit: "piece" as const,
      sellPricePiasters: 8500, // 85.00 EGP
      buyCostPiasters: 7200, // 72.00 EGP
      initialQuantity: 15, // 15 pieces
      isCustom: true,
      variants: [
        {
          flavor: "ذرة",
          sizeValue: 800,
          sizeUnit: "ml" as const,
          packQty: 1,
          sellPricePiasters: 8500,
          costPricePiasters: 7200,
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
    const productId = json.data.id;
    const variantId = json.data.variants[0].id;

    // Verify initial batch was created
    const batch = await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        return tx.storeStockBatch.findFirst({
          where: { storeProductId: productId, storeId: storeAId },
        });
      },
      appPrisma,
    );
    expect(batch).not.toBeNull();
    expect(Number(batch?.receivedQuantityBase)).toBe(15);
    expect(Number(batch?.remainingQuantityBase)).toBe(15);
    expect(Number(batch?.costPriceMinor)).toBe(7200);

    // Verify stock movement was recorded
    const movement = await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        return tx.stockMovement.findFirst({
          where: { storeProductId: productId, storeId: storeAId },
        });
      },
      appPrisma,
    );
    expect(movement).not.toBeNull();
    expect(movement?.type).toBe("initial_stock");
    expect(Number(movement?.quantityBase)).toBe(15);

    // Verify stock level is 15
    const stockLevel = await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        return tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId: storeAId,
              storeVariantId: variantId,
            },
          },
        });
      },
      appPrisma,
    );
    expect(stockLevel).not.toBeNull();
    expect(Number(stockLevel?.quantityBase)).toBe(15);

    // 2. Verify editing the product preserves stock quantity and does not overwrite inventory directly
    const editPayload = {
      id: productId,
      nameAr: `زيت ذرة كريستال ممتاز ${runId}`,
      category: "زيوت وسمن",
      unit: "piece" as const,
      sellPricePiasters: 9000,
      buyCostPiasters: 7500,
      initialQuantity: 999, // Should be ignored during edit to preserve inventory integrity!
      variants: [
        {
          id: variantId,
          flavor: "ذرة صافي",
          sizeValue: 800,
          sizeUnit: "ml" as const,
          packQty: 1,
          sellPricePiasters: 9000,
        },
      ],
    };

    const editReq = new Request("http://localhost:3000/api/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify(editPayload),
    });

    const editRes = await postProductsRoute(editReq);
    expect(editRes.status).toBe(200);

    // Stock level must STILL be 15, NOT 999
    const afterEditStock = await withTenant(
      storeAId,
      userAId,
      async (tx) => {
        return tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId: storeAId,
              storeVariantId: variantId,
            },
          },
        });
      },
      appPrisma,
    );
    expect(Number(afterEditStock?.quantityBase)).toBe(15);

    // 3. Verify GET /api/products returns summary and stock level
    const getReq = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const getRes = await getProductsRoute(getReq);
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.summary).toBeDefined();
    expect(getJson.summary.total).toBeGreaterThanOrEqual(1);

    const productInList = getJson.products.find(
      (p: { id: string }) => p.id === productId,
    );
    expect(productInList).toBeDefined();
    expect(productInList.stock_quantity).toBe(15);
    expect(productInList.buy_cost_piasters).toBe(7200);
    expect(productInList.sell_price_piasters).toBe(9000);
  });

  it("unified shared global catalog: Store A and Store B both see approved global products without duplicate rows", async () => {
    // Seed an approved global product in global_products
    const globalBrand = await migratorPrisma.brand.create({
      data: {
        nameAr: `علامة تجارية ${runId}`,
      },
    });

    const globalProd = await migratorPrisma.globalProduct.create({
      data: {
        brandId: globalBrand.id,
        nameAr: `شاي عالمي موحد ${runId}`,
        nameNorm: `شاي عالمي موحد ${runId}`,
        category: "مشروبات",
        type: "stock",
        status: "approved",
      },
    });

    const globalVar = await migratorPrisma.globalVariant.create({
      data: {
        globalProductId: globalProd.id,
        flavor: "سادة",
        sizeValue: 100,
        sizeUnit: "g",
        packQty: 12,
        nameNorm: `شاي عالمي موحد ${runId} سادة 100g`,
      },
    });

    // 1. Store A queries products
    const sessionA = await createSession(userAId, storeAId);
    const reqA = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const resA = await getProductsRoute(reqA);
    const jsonA = await resA.json();

    const itemA = jsonA.products.find(
      (p: { global_product_id: string }) =>
        p.global_product_id === globalProd.id,
    );
    expect(itemA).toBeDefined();
    expect(itemA.name_ar).toBe(`شاي عالمي موحد ${runId}`);
    expect(itemA.brand_name).toBe(`علامة تجارية ${runId}`);
    expect(itemA.variants).toHaveLength(1);
    expect(itemA.variants[0].pack_qty).toBe(12);

    // 2. Store B queries products without any import step
    const sessionB = await createSession(userBId, storeBId);
    const reqB = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionB.rawToken}` },
    });
    const resB = await getProductsRoute(reqB);
    const jsonB = await resB.json();

    const itemB = jsonB.products.find(
      (p: { global_product_id: string }) =>
        p.global_product_id === globalProd.id,
    );
    expect(itemB).toBeDefined();
    expect(itemB.name_ar).toBe(`شاي عالمي موحد ${runId}`);

    // Verify zero rows in store_products for this global product before any customization
    const storeARows = await migratorPrisma.storeProduct.count({
      where: { globalProductId: globalProd.id },
    });
    expect(storeARows).toBe(0);

    // Clean up
    await migratorPrisma.globalVariant.delete({ where: { id: globalVar.id } });
    await migratorPrisma.globalProduct.delete({ where: { id: globalProd.id } });
    await migratorPrisma.brand.delete({ where: { id: globalBrand.id } });
  });

  it("store price overrides and isolation: Store A sets custom prices on global item without affecting Store B", async () => {
    const globalProd = await migratorPrisma.globalProduct.create({
      data: {
        nameAr: `لبن طبيعي ${runId}`,
        nameNorm: `لبن طبيعي ${runId}`,
        category: "ألبان",
        type: "stock",
        status: "approved",
      },
    });

    const globalVar = await migratorPrisma.globalVariant.create({
      data: {
        globalProductId: globalProd.id,
        sizeValue: 1,
        sizeUnit: "l",
        packQty: 1,
        nameNorm: `لبن طبيعي 1l`,
      },
    });

    const sessionA = await createSession(userAId, storeAId);
    const sessionB = await createSession(userBId, storeBId);

    // Store A overrides price to 40.00 EGP (4000 piasters) and buy price 34.00 EGP (3400 piasters)
    const overrideReqA = new Request("http://localhost:3000/api/products", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${sessionA.rawToken}`,
      },
      body: JSON.stringify({
        id: `gp_${globalProd.id}`,
        nameAr: `لبن طبيعي ${runId}`,
        category: "ألبان",
        unit: "piece",
        sellPricePiasters: 4000,
        buyCostPiasters: 3400,
        globalProductId: globalProd.id,
        isCustom: false,
        variants: [
          {
            id: `gp_${globalVar.id}`,
            packQty: 1,
            sellPricePiasters: 4000,
            costPricePiasters: 3400,
            globalVariantId: globalVar.id,
          },
        ],
      }),
    });
    const overrideResA = await postProductsRoute(overrideReqA);
    expect(overrideResA.status).toBe(200);

    // Query Store A
    const reqA = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionA.rawToken}` },
    });
    const resA = await getProductsRoute(reqA);
    const jsonA = await resA.json();
    const itemA = jsonA.products.find(
      (p: { global_product_id: string }) =>
        p.global_product_id === globalProd.id,
    );
    expect(itemA.sell_price_piasters).toBe(4000);
    expect(itemA.buy_cost_piasters).toBe(3400);

    // Query Store B: Store B does NOT see Store A's override
    const reqB = new Request("http://localhost:3000/api/products", {
      headers: { cookie: `hesba_session=${sessionB.rawToken}` },
    });
    const resB = await getProductsRoute(reqB);
    const jsonB = await resB.json();
    const itemB = jsonB.products.find(
      (p: { global_product_id: string }) =>
        p.global_product_id === globalProd.id,
    );
    expect(itemB.sell_price_piasters).toBe(0); // Store B has not set its own price yet

    // Clean up
    await migratorPrisma.storeVariant.deleteMany({
      where: { productId: globalProd.id },
    });
    await migratorPrisma.storeProduct.deleteMany({
      where: { globalProductId: globalProd.id },
    });
    await migratorPrisma.globalVariant.delete({ where: { id: globalVar.id } });
    await migratorPrisma.globalProduct.delete({ where: { id: globalProd.id } });
  });

  it("hiding and unhiding: Store A hides global product for itself only without affecting Store B", async () => {
    const globalProd = await migratorPrisma.globalProduct.create({
      data: {
        nameAr: `بسكويت بالشوكولاتة ${runId}`,
        nameNorm: `بسكويت بالشوكولاتة ${runId}`,
        category: "حلويات",
        type: "stock",
        status: "approved",
      },
    });

    const catalogService = new CatalogService(appPrisma);

    // Store A hides the product
    const hideRes = await catalogService.hideStoreProduct(
      storeAId,
      userAId,
      `gp_${globalProd.id}`,
    );
    expect(hideRes.success).toBe(true);

    // Store A queries active products -> hidden
    const prodsA = await catalogService.getStoreProducts(storeAId, userAId);
    const foundA = prodsA.find((p) => p.globalProductId === globalProd.id);
    expect(foundA).toBeUndefined();

    // Store A queries with includeHidden -> found with is_hidden: true
    const prodsAHidden = await catalogService.getStoreProducts(
      storeAId,
      userAId,
      { includeHidden: true },
    );
    const hiddenFound = prodsAHidden.find(
      (p) => p.globalProductId === globalProd.id,
    );
    expect(hiddenFound).toBeDefined();
    expect(hiddenFound?.is_hidden).toBe(true);

    // Store B queries active products -> STILL ACTIVE and visible for Store B!
    const prodsB = await catalogService.getStoreProducts(storeBId, userBId);
    const foundB = prodsB.find((p) => p.globalProductId === globalProd.id);
    expect(foundB).toBeDefined();
    expect(foundB?.is_hidden).toBe(false);

    // Store A unhides the product
    const unhideRes = await catalogService.unhideStoreProduct(
      storeAId,
      userAId,
      `gp_${globalProd.id}`,
    );
    expect(unhideRes.success).toBe(true);

    // Store A queries active products -> visible again!
    const prodsAAfter = await catalogService.getStoreProducts(
      storeAId,
      userAId,
    );
    const restoredFound = prodsAAfter.find(
      (p) => p.globalProductId === globalProd.id,
    );
    expect(restoredFound).toBeDefined();
    expect(restoredFound?.is_hidden).toBe(false);

    // Clean up
    await migratorPrisma.storeProduct.deleteMany({
      where: { globalProductId: globalProd.id },
    });
    await migratorPrisma.globalProduct.delete({ where: { id: globalProd.id } });
  });

  it("safely handles editing prices for a catalog product where variant id is a GlobalVariant id", async () => {
    // 1. Create a global product with a global variant
    const gvId = crypto.randomUUID();
    const gpId = crypto.randomUUID();

    await migratorPrisma.globalProduct.create({
      data: {
        id: gpId,
        nameAr: `منتج كتالوج للتعديل ${runId}`,
        nameNorm: `منتج كتالوج للتعديل ${runId}`,
        category: "مشروبات",
        globalVariants: {
          create: {
            id: gvId,
            packQty: 12,
            nameNorm: `منتج كتالوج للتعديل ${runId}`,
          },
        },
      },
    });

    const catalogService = new CatalogService(appPrisma);

    // 2. Call upsertStoreProduct passing the GlobalVariant id as v.id
    // This simulates the frontend sending the ID it received from getStoreProducts
    const upsertRes = await catalogService.upsertStoreProduct(
      storeAId,
      userAId,
      {
        id: `gp_${gpId}`,
        nameAr: `منتج كتالوج للتعديل ${runId}`,
        category: "مشروبات",
        unit: "piece",
        sellPricePiasters: 1800,
        buyCostPiasters: 1400,
        globalProductId: gpId,
        variants: [
          {
            id: gvId, // GlobalVariant id, NOT storeVariant id!
            packQty: 12,
            sellPricePiasters: 1800,
            costPricePiasters: 1400,
            globalVariantId: gvId,
          },
        ],
      },
    );

    expect(upsertRes.storeProductId).toBeDefined();
    expect(upsertRes.variants).toHaveLength(1);
    expect(upsertRes.variants[0]?.sellPricePiasters).toBe(BigInt(1800));
    expect(upsertRes.variants[0]?.buyPricePiasters).toBe(BigInt(1400));
    expect(upsertRes.variants[0]?.globalVariantId).toBe(gvId);

    // 3. Now update it again with the newly created store variant ID
    const createdStoreVariantId = upsertRes.variants[0]!.id;
    const updateRes = await catalogService.upsertStoreProduct(
      storeAId,
      userAId,
      {
        id: upsertRes.storeProductId,
        nameAr: `منتج كتالوج للتعديل ${runId}`,
        category: "مشروبات",
        unit: "piece",
        sellPricePiasters: 2000,
        buyCostPiasters: 1500,
        globalProductId: gpId,
        variants: [
          {
            id: createdStoreVariantId,
            packQty: 12,
            sellPricePiasters: 2000,
            costPricePiasters: 1500,
            globalVariantId: gvId,
          },
        ],
      },
    );

    expect(updateRes.variants[0]?.sellPricePiasters).toBe(BigInt(2000));
    expect(updateRes.variants[0]?.buyPricePiasters).toBe(BigInt(1500));

    // Cleanup
    await migratorPrisma.storeProduct.deleteMany({
      where: { id: upsertRes.storeProductId },
    });
    await migratorPrisma.globalProduct.delete({ where: { id: gpId } });
  });
});
