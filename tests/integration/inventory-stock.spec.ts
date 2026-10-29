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
});
