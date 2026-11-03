import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { InventoryService } from "@/server/modules/inventory";
import { CatalogService } from "@/server/modules/catalog";

const directUrl =
  process.env["HESBA_DIRECT_URL"] ??
  "postgres://hesba_migrator:change-me-local@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("Inventory, Batches, Movements & FEFO (Phase 3.5 Integration)", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;
  let variantAId: string;
  const runId = Math.random().toString(36).slice(2, 8);

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: {
      name: string;
      shopType: string;
      governorate: string;
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

    // Create test users
    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `تاجر مخزون أ ${runId}`,
          phone: `+20101${runId}`,
          email: `stock-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `تاجر مخزون ب ${runId}`,
          phone: `+20102${runId}`,
          email: `stock-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    // Create test stores
    await createStoreWithRLS(storeAId, userAId, {
      name: `محل مخزون أ ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `محل مخزون ب ${runId}`,
      shopType: "kiosk",
      governorate: "Giza",
    });

    // Create a product and variant in Store A
    const catalogService = new CatalogService(appPrisma);
    const prod = await catalogService.upsertStoreProduct(storeAId, userAId, {
      nameAr: `زبادي بلدي ${runId}`,
      category: "الجبن والألبان والزبادي",
      unit: "piece",
      sellPricePiasters: 800,
      isCustom: true,
      variants: [
        {
          flavor: "سادة",
          packQty: 1,
          sellPricePiasters: 800,
        },
      ],
    });

    variantAId = prod.variants[0]!.id;
  });

  afterAll(async () => {
    if (storeAId && storeBId) {
      await migratorClient.unsafe(`
        ALTER TABLE waste_records DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_levels DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_stock_batches DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stores DISABLE ROW LEVEL SECURITY;

        DELETE FROM waste_records WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stock_levels WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stock_movements WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_stock_batches WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_variants WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_products WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_members WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stores WHERE id IN ('${storeAId}', '${storeBId}');

        ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_stock_batches ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
        ALTER TABLE waste_records ENABLE ROW LEVEL SECURITY;
      `);
      await migratorClient`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    }

    await migratorPrisma.$disconnect();
    await appPrisma.$disconnect();
    await migratorClient.end();
  });

  it("adds stock batch, logs purchase movement, and updates stock_levels balance", async () => {
    const inventory = new InventoryService(appPrisma);

    const result = await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: variantAId,
      receivedQuantityBase: 50,
      costPriceMinor: 500, // 5.00 EGP buy cost
      expiryDate: new Date("2026-11-20"),
      batchCode: "BATCH-001",
    });

    expect(result.batchId).toBeDefined();
    expect(result.movementId).toBeDefined();
    expect(result.newBalance).toBe(50);
    expect(result.duplicate).toBe(false);

    // Verify stock levels cache in DB
    const [level] = await migratorClient<Array<{ quantity_base: string }>>`
      SELECT quantity_base FROM stock_levels
      WHERE store_id = ${storeAId}::uuid AND store_variant_id = ${variantAId}::uuid
    `;
    expect(BigInt(level?.quantity_base ?? 0)).toBe(BigInt(50));

    // Verify movement recorded
    const [movement] = await migratorClient<
      Array<{ type: string; quantity_base: string; cost_price_minor: string }>
    >`
      SELECT type, quantity_base, cost_price_minor FROM stock_movements
      WHERE id = ${result.movementId!}::uuid
    `;
    expect(movement?.type).toBe("purchase");
    expect(BigInt(movement?.quantity_base ?? 0)).toBe(BigInt(50));
    expect(BigInt(movement?.cost_price_minor ?? 0)).toBe(BigInt(500));
  });

  it("enforces FEFO depletion across multiple batches during sales", async () => {
    const inventory = new InventoryService(appPrisma);

    // Add Batch 2: Earlier expiry (expires in 5 days)
    const earlyBatch = await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: variantAId,
      receivedQuantityBase: 20,
      costPriceMinor: 520,
      expiryDate: new Date("2026-11-05"), // Expires BEFORE 2026-11-20!
      batchCode: "BATCH-EARLY",
    });

    // Current stock balance should now be 50 + 20 = 70
    expect(earlyBatch.newBalance).toBe(70);

    // Deplete 30 units for a sale:
    // Expected: 20 units taken from earlyBatch (exhausting it), 10 units taken from first batch
    const saleResult = await inventory.depleteStockForSale(storeAId, userAId, {
      storeVariantId: variantAId,
      quantityBase: 30,
    });

    expect(saleResult.allocations).toBeDefined();
    expect(saleResult.allocations).toHaveLength(2);
    // First allocation must be the early batch
    expect(saleResult.allocations![0]?.batchId).toBe(earlyBatch.batchId);
    expect(saleResult.allocations![0]?.quantityBase).toBe(20);

    // Remaining 10 taken from the later batch
    expect(saleResult.allocations![1]?.quantityBase).toBe(10);
    expect(saleResult.newBalance).toBe(40);

    // Early batch remaining should now be 0
    const [earlyBatchDb] = await migratorClient<
      Array<{ remaining_quantity_base: string }>
    >`
      SELECT remaining_quantity_base FROM store_stock_batches
      WHERE id = ${earlyBatch.batchId!}::uuid
    `;
    expect(BigInt(earlyBatchDb?.remaining_quantity_base ?? 0)).toBe(BigInt(0));
  });

  it("records waste, decrements remaining batch stock, and updates stock balance", async () => {
    const inventory = new InventoryService(appPrisma);

    const wasteResult = await inventory.recordWaste(storeAId, userAId, {
      storeVariantId: variantAId,
      quantityBase: 5,
      reason: "damaged_spill",
    });

    expect(wasteResult.wasteId).toBeDefined();
    expect(wasteResult.newBalance).toBe(35); // 40 - 5 = 35

    const [wasteDb] = await migratorClient<
      Array<{ quantity_base: string; reason: string }>
    >`
      SELECT quantity_base, reason FROM waste_records
      WHERE id = ${wasteResult.wasteId!}::uuid
    `;
    expect(BigInt(wasteDb?.quantity_base ?? 0)).toBe(BigInt(5));
    expect(wasteDb?.reason).toBe("damaged_spill");
  });

  it("strictly holds the mathematical invariant: stock_levels == SUM(stock_movements)", async () => {
    const [cached] = await migratorClient<Array<{ quantity_base: string }>>`
      SELECT quantity_base FROM stock_levels
      WHERE store_id = ${storeAId}::uuid AND store_variant_id = ${variantAId}::uuid
    `;

    const [sumMovements] = await migratorClient<Array<{ sum: string }>>`
      SELECT COALESCE(SUM(quantity_base), 0) AS sum FROM stock_movements
      WHERE store_id = ${storeAId}::uuid AND store_variant_id = ${variantAId}::uuid
    `;

    expect(BigInt(cached?.quantity_base ?? 0)).toBe(
      BigInt(sumMovements?.sum ?? 0),
    );
  });

  it("enforces tenant isolation: Store B cannot access or deplete Store A stock", async () => {
    const inventory = new InventoryService(appPrisma);

    // Store B tries to deplete Store A's variant
    await expect(
      inventory.depleteStockForSale(storeBId, userBId, {
        storeVariantId: variantAId,
        quantityBase: 10,
      }),
    ).rejects.toThrow();

    // Store B inventory query returns empty
    const storeBInv = await inventory.getStoreInventory(storeBId, userBId);
    expect(storeBInv).toHaveLength(0);
  });

  it("handles productionDate and expiryDate with validation and supports products with no expiry", async () => {
    const inventory = new InventoryService(appPrisma);

    // 1. Success: batch with productionDate and expiryDate where expiryDate >= productionDate
    const batchRes = await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: variantAId,
      receivedQuantityBase: 12,
      costPriceMinor: 1000,
      productionDate: "2026-11-01",
      expiryDate: "2027-05-01",
      batchCode: "BATCH-EXP-01",
    });

    expect(batchRes.batchId).toBeDefined();

    const [batchDb] = await migratorClient<
      Array<{
        production_date: string | null;
        expiry_date: string | null;
        batch_code: string;
      }>
    >`
      SELECT production_date::text, expiry_date::text, batch_code
      FROM store_stock_batches
      WHERE id = ${batchRes.batchId}::uuid
    `;

    expect(batchDb?.production_date).toBe("2026-11-01");
    expect(batchDb?.expiry_date).toBe("2027-05-01");
    expect(batchDb?.batch_code).toBe("BATCH-EXP-01");

    // 2. Failure: batch where expiryDate < productionDate
    await expect(
      inventory.addStockBatch(storeAId, userAId, {
        storeVariantId: variantAId,
        receivedQuantityBase: 6,
        costPriceMinor: 1000,
        productionDate: "2026-11-01",
        expiryDate: "2026-10-01", // before production date!
      }),
    ).rejects.toThrow("تاريخ الانتهاء يجب ألا يكون قبل تاريخ الإنتاج");

    // 3. Success: product with no expiry (e.g. detergents / tissues)
    const noExpBatch = await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: variantAId,
      receivedQuantityBase: 24,
      costPriceMinor: 800,
      productionDate: null,
      expiryDate: null,
      batchCode: "NO-EXP-01",
    });

    expect(noExpBatch.batchId).toBeDefined();

    const [noExpDb] = await migratorClient<
      Array<{ expiry_date: string | null }>
    >`
      SELECT expiry_date::text
      FROM store_stock_batches
      WHERE id = ${noExpBatch.batchId}::uuid
    `;

    expect(noExpDb?.expiry_date).toBeNull();
  });

  it("resolves stock batch creation when given a GlobalVariant ID and throws AppError.notFound on unknown ID", async () => {
    const inventory = new InventoryService(appPrisma);

    // 1. Create a global product and variant
    const gpId = crypto.randomUUID();
    const gvId = crypto.randomUUID();
    await migratorPrisma.globalProduct.create({
      data: {
        id: gpId,
        nameAr: `شاي العروسة تيست ${runId}`,
        nameNorm: `شاي العروسه تيست ${runId}`,
        category: "مشروبات",
        globalVariants: {
          create: {
            id: gvId,
            nameNorm: `شاي العروسه تيست ${runId}`,
            packQty: 1,
            sizeValue: 250,
            sizeUnit: "g",
          },
        },
      },
    });

    // 2. Add stock using gvId directly for Store A
    const res = await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: gvId,
      receivedQuantityBase: 10,
      costPriceMinor: 2500,
      expiryDate: "2027-12-31",
    });

    expect(res.batchId).toBeDefined();
    expect(res.newBalance).toBe(10);

    const [batchRow] = await migratorClient<
      Array<{ store_product_id: string; store_variant_id: string }>
    >`
      SELECT store_product_id::text, store_variant_id::text
      FROM store_stock_batches
      WHERE id = ${res.batchId}::uuid
    `;

    const spRow = await withTenant(
      storeAId,
      userAId,
      async (tx) =>
        tx.storeProduct.findUnique({
          where: { id: batchRow!.store_product_id },
        }),
      appPrisma,
    );

    expect(spRow).toBeDefined();
    expect(spRow?.globalProductId).toBe(gpId);

    // 4. Void / revert the added batch
    const voidRes = await inventory.voidStockBatch(storeAId, userAId, {
      batchId: res.batchId!,
    });
    expect(voidRes.voidedQuantity).toBe(10);
    expect(voidRes.newBalance).toBe(0);

    const levelAfterVoid = await migratorPrisma.stockLevel.findFirst({
      where: {
        storeId: storeAId,
        storeVariantId: res.batchId ? batchRow!.store_variant_id : "",
      },
    });
    expect(Number(levelAfterVoid?.quantityBase)).toBe(0);

    // 5. Unknown variant ID throws AppError with NOT_FOUND status
    const fakeVariantId = crypto.randomUUID();
    await expect(
      inventory.addStockBatch(storeAId, userAId, {
        storeVariantId: fakeVariantId,
        receivedQuantityBase: 5,
        costPriceMinor: 1000,
      }),
    ).rejects.toThrow("الصنف غير موجود أو غير متاح في هذا المحل");
  });

  it("adjusts stock quantity via 'set' and 'delta' modes and creates append-only adjustment movements", async () => {
    const catalog = new CatalogService(appPrisma);
    const prod = await catalog.upsertStoreProduct(storeAId, userAId, {
      nameAr: `شيبسي ملح تيست ${runId}`,
      category: "سناكس",
      unit: "piece",
      sellPricePiasters: 1000,
      isCustom: true,
      variants: [{ flavor: "ملح", packQty: 1, sellPricePiasters: 1000 }],
    });
    const testVarId = prod.variants[0]!.id;

    const inventory = new InventoryService(appPrisma);

    // 1. Initial batch: 20 units
    const addRes = await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: testVarId,
      receivedQuantityBase: 20,
      costPriceMinor: 1200,
    });
    expect(addRes.batchId).toBeDefined();

    // 2. Adjust using mode="set" to 35 (an increase of 15)
    const adjSetRes = await inventory.adjustStockQuantity(storeAId, userAId, {
      storeVariantId: testVarId,
      mode: "set",
      targetQuantityBase: 35,
      reason: "جرد دوري شهري",
    });

    expect(adjSetRes.newBalance).toBe(35);
    expect(adjSetRes.adjustedDelta).toBe(15);
    expect(adjSetRes.movementId).toBeDefined();

    // Verify stock_levels
    const level1 = await migratorPrisma.stockLevel.findUnique({
      where: {
        storeId_storeVariantId: {
          storeId: storeAId,
          storeVariantId: testVarId,
        },
      },
    });
    expect(Number(level1?.quantityBase)).toBe(35);

    // 3. Adjust using mode="delta" by -10 (a decrease of 10)
    const adjDeltaRes = await inventory.adjustStockQuantity(storeAId, userAId, {
      storeVariantId: testVarId,
      mode: "delta",
      deltaQuantityBase: -10,
      reason: "تسوية عجز تالف",
    });

    expect(adjDeltaRes.newBalance).toBe(25);
    expect(adjDeltaRes.adjustedDelta).toBe(-10);

    // Verify movement
    const movement = await migratorPrisma.stockMovement.findUnique({
      where: { id: adjDeltaRes.movementId! },
    });
    expect(movement?.type).toBe("adjustment");
    expect(Number(movement?.quantityBase)).toBe(-10);
    expect(Number(movement?.balanceAfterBase)).toBe(25);

    // 4. Negative resulting balance throws error
    await expect(
      inventory.adjustStockQuantity(storeAId, userAId, {
        storeVariantId: testVarId,
        mode: "delta",
        deltaQuantityBase: -50, // exceeds current 25
      }),
    ).rejects.toThrow("الكمية الناتجة بعد الخصم لا يمكن أن تكون سالبة");

    // 5. Tenant isolation: Store B cannot adjust Store A variant
    await expect(
      inventory.adjustStockQuantity(storeBId, userBId, {
        storeVariantId: testVarId,
        mode: "set",
        targetQuantityBase: 10,
      }),
    ).rejects.toThrow("الصنف غير موجود أو غير متاح في هذا المحل");
  });

  it("clears variant stock to zero, records adjustment movement, and optionally deactivates variant", async () => {
    const catalog = new CatalogService(appPrisma);
    const prod = await catalog.upsertStoreProduct(storeAId, userAId, {
      nameAr: `عصير تفاح تيست ${runId}`,
      category: "مشروبات",
      unit: "piece",
      sellPricePiasters: 1500,
      isCustom: true,
      variants: [{ flavor: "تفاح", packQty: 1, sellPricePiasters: 1500 }],
    });
    const clearVarId = prod.variants[0]!.id;

    const inventory = new InventoryService(appPrisma);

    // Add initial stock: 10 units
    await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: clearVarId,
      receivedQuantityBase: 10,
      costPriceMinor: 1000,
    });

    // Clear stock and remove from view
    const clearRes = await inventory.clearVariantStock(storeAId, userAId, {
      storeVariantId: clearVarId,
      removeFromView: true,
      reason: "توقف التعامل مع المنتج وتصفيره",
    });

    expect(clearRes.clearedQuantity).toBe(10);
    expect(clearRes.removedFromView).toBe(true);

    // Verify stock_levels is 0
    const levelAfterClear = await migratorPrisma.stockLevel.findUnique({
      where: {
        storeId_storeVariantId: {
          storeId: storeAId,
          storeVariantId: clearVarId,
        },
      },
    });
    expect(Number(levelAfterClear?.quantityBase)).toBe(0);

    // Verify all active batches are zeroed
    const activeBatches = await migratorPrisma.storeStockBatch.findMany({
      where: {
        storeId: storeAId,
        storeVariantId: clearVarId,
        remainingQuantityBase: { gt: BigInt(0) },
      },
    });
    expect(activeBatches).toHaveLength(0);

    // Verify StoreVariant.isActive is false
    const variantRow = await withTenant(
      storeAId,
      userAId,
      async (tx) =>
        tx.storeVariant.findUnique({
          where: { id: clearVarId },
        }),
      appPrisma,
    );
    expect(variantRow?.isActive).toBe(false);

    // Store B cannot clear Store A variant
    await expect(
      inventory.clearVariantStock(storeBId, userBId, {
        storeVariantId: clearVarId,
      }),
    ).rejects.toThrow("الصنف غير موجود في هذا المحل");
  });

  it("archives variant from active inventory view only when stock is zero", async () => {
    const catalog = new CatalogService(appPrisma);
    const prod = await catalog.upsertStoreProduct(storeAId, userAId, {
      nameAr: `شاي أخضر للتجربة ${runId}`,
      category: "مشروبات",
      unit: "piece",
      sellPricePiasters: 3000,
      isCustom: true,
      variants: [{ flavor: "نعناع", packQty: 1, sellPricePiasters: 3000 }],
    });
    const archiveVarId = prod.variants[0]!.id;
    const inventory = new InventoryService(appPrisma);

    // 1. Add positive stock
    await inventory.addStockBatch(storeAId, userAId, {
      storeVariantId: archiveVarId,
      receivedQuantityBase: 5,
      costPriceMinor: 2000,
    });

    // 2. Archiving with positive stock should be blocked
    await expect(
      inventory.archiveVariantFromView(storeAId, userAId, {
        storeVariantId: archiveVarId,
      }),
    ).rejects.toThrow(
      "لا يمكن إزالة الصنف من قائمة المخزون النشطة لأن رصيده الحالي موجب. يرجى تصفير المخزون أولاً.",
    );

    // 3. Clear stock to 0 first (pure zeroing, keep in view)
    const clearRes = await inventory.clearVariantStock(storeAId, userAId, {
      storeVariantId: archiveVarId,
      removeFromView: false,
      reason: "تصفير قبل الأرشفة",
    });
    expect(clearRes.clearedQuantity).toBe(5);

    // Check variant is still active after pure zeroing
    const variantStillActive = await withTenant(
      storeAId,
      userAId,
      async (tx) =>
        tx.storeVariant.findUnique({
          where: { id: archiveVarId },
        }),
      appPrisma,
    );
    expect(variantStillActive?.isActive).toBe(true);

    // 4. Archiving when stock is 0 now succeeds
    const archiveRes = await inventory.archiveVariantFromView(
      storeAId,
      userAId,
      {
        storeVariantId: archiveVarId,
      },
    );
    expect(archiveRes.archived).toBe(true);

    const variantArchived = await withTenant(
      storeAId,
      userAId,
      async (tx) =>
        tx.storeVariant.findUnique({
          where: { id: archiveVarId },
        }),
      appPrisma,
    );
    expect(variantArchived?.isActive).toBe(false);

    // 5. Tenant isolation check
    await expect(
      inventory.archiveVariantFromView(storeBId, userBId, {
        storeVariantId: archiveVarId,
      }),
    ).rejects.toThrow("الصنف غير موجود في هذا المحل");
  });
});
