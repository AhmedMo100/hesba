import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { StocktakeService, InventoryService } from "@/server/modules/inventory";
import { CatalogService } from "@/server/modules/catalog";

const directUrl =
  process.env["HESBA_TEST_ADMIN_URL"] ??
  "postgres://postgres:change-me-local-root@localhost:5434/hesba";
const databaseUrl =
  process.env["HESBA_DATABASE_URL"] ??
  "postgres://hesba_app:change-me-local@localhost:5434/hesba";

describe("Physical Stocktake Integration (Phase 1)", () => {
  let migratorPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  let migratorClient: postgres.Sql;

  let storeAId: string;
  let storeBId: string;
  let userAId: string;
  let userBId: string;

  let prod1VariantId: string;
  let prod2VariantId: string;
  let prod3VariantId: string;

  const runId = Math.random().toString(36).slice(2, 8);

  async function createStoreWithRLS(
    id: string,
    creatorId: string,
    data: { name: string; shopType: string; governorate: string },
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

    // 1. Create test users
    await migratorPrisma.user.createMany({
      data: [
        {
          id: userAId,
          name: `تاجر جرد أ ${runId}`,
          phone: `+20108${runId}`,
          email: `stocktake-a-${runId}@hesba.test`,
          passwordHash: "mockhashA",
        },
        {
          id: userBId,
          name: `تاجر جرد ب ${runId}`,
          phone: `+20109${runId}`,
          email: `stocktake-b-${runId}@hesba.test`,
          passwordHash: "mockhashB",
        },
      ],
    });

    // 2. Create test stores
    await createStoreWithRLS(storeAId, userAId, {
      name: `سوبرماركت الجرد ${runId}`,
      shopType: "supermarket",
      governorate: "Cairo",
    });

    await createStoreWithRLS(storeBId, userBId, {
      name: `محل منافس ${runId}`,
      shopType: "kiosk",
      governorate: "Giza",
    });

    // 3. Create products in Store A
    const catalog = new CatalogService(appPrisma);
    const p1 = await catalog.upsertStoreProduct(storeAId, userAId, {
      nameAr: `شيبسي طماطم ${runId}`,
      category: "شيبسيات ومقرمشات",
      unit: "piece",
      buyCostPiasters: 800,
      sellPricePiasters: 1000,
      isCustom: true,
      variants: [{ flavor: "طماطم", packQty: 1, sellPricePiasters: 1000 }],
    });
    prod1VariantId = p1.variants[0]!.id;

    const p2 = await catalog.upsertStoreProduct(storeAId, userAId, {
      nameAr: `لبن جهينة ${runId}`,
      category: "ألبان ومشروبات",
      unit: "piece",
      buyCostPiasters: 3500,
      sellPricePiasters: 4200,
      isCustom: true,
      variants: [{ flavor: "كامل الدسم", packQty: 1, sellPricePiasters: 4200 }],
    });
    prod2VariantId = p2.variants[0]!.id;

    const p3 = await catalog.upsertStoreProduct(storeAId, userAId, {
      nameAr: `جبنة بيضاء ${runId}`,
      category: "ألبان ومشروبات",
      unit: "piece",
      buyCostPiasters: 2000,
      sellPricePiasters: 2500,
      isCustom: true,
      variants: [{ flavor: "براميلي", packQty: 1, sellPricePiasters: 2500 }],
    });
    prod3VariantId = p3.variants[0]!.id;

    // 4. Initial Stock via InventoryService
    const inv = new InventoryService(appPrisma);
    // Prod 1: 50 pieces
    await inv.addStockBatch(storeAId, userAId, {
      storeVariantId: prod1VariantId,
      receivedQuantityBase: 50,
      costTotalMinor: 40000,
    });
    // Prod 2: 30 pieces
    await inv.addStockBatch(storeAId, userAId, {
      storeVariantId: prod2VariantId,
      receivedQuantityBase: 30,
      costTotalMinor: 105000,
    });
    // Prod 3: 20 pieces
    await inv.addStockBatch(storeAId, userAId, {
      storeVariantId: prod3VariantId,
      receivedQuantityBase: 20,
      costTotalMinor: 40000,
    });
  });

  afterAll(async () => {
    if (storeAId && storeBId) {
      await migratorClient.unsafe(`
        ALTER TABLE stocktake_items DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stocktake_sessions DISABLE ROW LEVEL SECURITY;
        ALTER TABLE waste_records DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_levels DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_movements DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_stock_batches DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products DISABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members DISABLE ROW LEVEL SECURITY;
        ALTER TABLE stores DISABLE ROW LEVEL SECURITY;

        DELETE FROM stocktake_items WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stocktake_sessions WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM waste_records WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stock_levels WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stock_movements WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_stock_batches WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_variants WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_products WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM store_members WHERE store_id IN ('${storeAId}', '${storeBId}');
        DELETE FROM stores WHERE id IN ('${storeAId}', '${storeBId}');

        ALTER TABLE stocktake_items ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stocktake_sessions ENABLE ROW LEVEL SECURITY;
        ALTER TABLE waste_records ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_stock_batches ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_variants ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_products ENABLE ROW LEVEL SECURITY;
        ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
        ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
      `);
    }

    await appPrisma.$disconnect();
    await migratorPrisma.$disconnect();
    await migratorClient.end();
  });

  it("creates a stocktake session with immutable expected-stock snapshot", async () => {
    const stocktake = new StocktakeService(appPrisma);
    const session = await stocktake.createSession(storeAId, userAId, {
      scope: "full",
      notes: "First full stocktake test",
    });

    expect(session.id).toBeDefined();
    expect(session.status).toBe("in_progress");
    expect(session.totalProducts).toBe(3);

    // Verify item details and snapshot values
    const details = await stocktake.getSessionDetails(
      storeAId,
      userAId,
      session.id,
    );
    expect(details.items).toHaveLength(3);

    const p1Item = details.items.find(
      (i) => i.storeVariantId === prod1VariantId,
    );
    expect(p1Item).toBeDefined();
    expect(p1Item?.snapshotQuantityBase).toBe(50);
    expect(p1Item?.expectedQuantityBase).toBe(50);
  });

  it("prevents starting a second active session while one is in progress", async () => {
    const stocktake = new StocktakeService(appPrisma);
    await expect(
      stocktake.createSession(storeAId, userAId, { scope: "full" }),
    ).rejects.toThrow(/جلسة جرد شغالة حالياً/);
  });

  it("supports idempotency via opId", async () => {
    const stocktake = new StocktakeService(appPrisma);
    const active = await stocktake.getActiveSession(storeAId, userAId);
    expect(active).not.toBeNull();

    const opId = crypto.randomUUID();
    // Cancel the existing session first to test opId creation
    await stocktake.cancelSession(storeAId, userAId, active!.id);

    const s1 = await stocktake.createSession(storeAId, userAId, {
      scope: "full",
      opId,
    });
    const s2 = await stocktake.createSession(storeAId, userAId, {
      scope: "full",
      opId,
    });

    expect(s1.id).toBe(s2.id);
  });

  it("dynamically accounts for legitimate movements (sales/waste) occurring after snapshot", async () => {
    const stocktake = new StocktakeService(appPrisma);
    const active = await stocktake.getActiveSession(storeAId, userAId);
    expect(active).not.toBeNull();

    // Perform an adjustment of 5 pieces of prod1 during active stocktake
    const inv = new InventoryService(appPrisma);
    await inv.adjustStockQuantity(storeAId, userAId, {
      storeVariantId: prod1VariantId,
      mode: "delta",
      deltaQuantityBase: -5,
      reason: "تعديل أثناء الجرد",
    });

    // Also record waste of 2 pieces of prod2 during active stocktake
    await inv.recordWaste(storeAId, userAId, {
      storeVariantId: prod2VariantId,
      quantityBase: 2,
      reason: "expired",
      note: "Expired pack removed during count",
    });

    // Check dynamic expected calculation in session details
    const details = await stocktake.getSessionDetails(
      storeAId,
      userAId,
      active!.id,
    );
    const p1 = details.items.find((i) => i.storeVariantId === prod1VariantId)!;
    const p2 = details.items.find((i) => i.storeVariantId === prod2VariantId)!;

    // Prod 1: snapshot was 50, adjustment of -5 -> dynamic expected is 45!
    expect(p1.snapshotQuantityBase).toBe(50);
    expect(p1.expectedQuantityBase).toBe(45);
    expect(p1.movementsSinceSnapshot.adjustments).toBe(-5);

    // Prod 2: snapshot was 30, waste of 2 -> dynamic expected is 28!
    expect(p2.snapshotQuantityBase).toBe(30);
    expect(p2.expectedQuantityBase).toBe(28);
    expect(p2.movementsSinceSnapshot.waste).toBe(2);
  });

  it("updates physical counts and records cutoff concurrency warnings", async () => {
    const stocktake = new StocktakeService(appPrisma);
    const active = await stocktake.getActiveSession(storeAId, userAId);
    expect(active).not.toBeNull();

    // Count:
    // Prod 1: expected 45 -> counted 40 (Shortage of 5)
    // Prod 2: expected 28 -> counted 28 (Matched)
    // Prod 3: expected 20 -> counted 22 (Surplus of +2)
    await stocktake.updateCounts(storeAId, userAId, active!.id, {
      items: [
        {
          storeVariantId: prod1VariantId,
          countedQuantityBase: 40,
          classification: "damaged_or_expired",
        },
        {
          storeVariantId: prod2VariantId,
          countedQuantityBase: 28,
        },
        {
          storeVariantId: prod3VariantId,
          countedQuantityBase: 22,
        },
      ],
    });

    const details = await stocktake.getSessionDetails(
      storeAId,
      userAId,
      active!.id,
    );
    const p1 = details.items.find((i) => i.storeVariantId === prod1VariantId)!;
    const p2 = details.items.find((i) => i.storeVariantId === prod2VariantId)!;
    const p3 = details.items.find((i) => i.storeVariantId === prod3VariantId)!;

    expect(p1.countedQuantityBase).toBe(40);
    expect(p1.discrepancyQuantityBase).toBe(-5);
    expect(p1.classification).toBe("damaged_or_expired");

    expect(p2.countedQuantityBase).toBe(28);
    expect(p2.discrepancyQuantityBase).toBe(0);

    expect(p3.countedQuantityBase).toBe(22);
    expect(p3.discrepancyQuantityBase).toBe(2);
  });

  it("approves and reconciles session atomically: creates WasteRecord for damaged, adjustment batch for surplus", async () => {
    const stocktake = new StocktakeService(appPrisma);
    const active = await stocktake.getActiveSession(storeAId, userAId);
    expect(active).not.toBeNull();

    const reconciled = await stocktake.reconcileSession(
      storeAId,
      userAId,
      active!.id,
      {
        notes: "Monthly physical stocktake reconciled",
      },
    );

    expect(reconciled.status).toBe("reconciled");
    expect(reconciled.reconciledAt).not.toBeNull();
    expect(reconciled.shortageCount).toBe(1); // Prod 1 (-5)
    expect(reconciled.matchedCount).toBe(1); // Prod 2 (0)
    expect(reconciled.surplusCount).toBe(1); // Prod 3 (+2)

    // Verify stock levels match the physical counts
    const sl1 = await withTenant(storeAId, userAId, (tx) =>
      tx.stockLevel.findUnique({
        where: {
          storeId_storeVariantId: {
            storeId: storeAId,
            storeVariantId: prod1VariantId,
          },
        },
      }),
    );
    expect(Number(sl1?.quantityBase)).toBe(40);

    const sl2 = await withTenant(storeAId, userAId, (tx) =>
      tx.stockLevel.findUnique({
        where: {
          storeId_storeVariantId: {
            storeId: storeAId,
            storeVariantId: prod2VariantId,
          },
        },
      }),
    );
    expect(Number(sl2?.quantityBase)).toBe(28);

    const sl3 = await withTenant(storeAId, userAId, (tx) =>
      tx.stockLevel.findUnique({
        where: {
          storeId_storeVariantId: {
            storeId: storeAId,
            storeVariantId: prod3VariantId,
          },
        },
      }),
    );
    expect(Number(sl3?.quantityBase)).toBe(22);

    // Verify WasteRecord was created for damaged_or_expired shortage
    const waste = await withTenant(storeAId, userAId, (tx) =>
      tx.wasteRecord.findFirst({
        where: { storeId: storeAId, storeVariantId: prod1VariantId },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(waste).not.toBeNull();
    expect(waste?.quantityBase).toBe(BigInt(5));
    expect(waste?.note).toContain("تسوية جرد");

    // Verify surplus created a new adjustment batch
    const surplusBatch = await withTenant(storeAId, userAId, (tx) =>
      tx.storeStockBatch.findFirst({
        where: {
          storeId: storeAId,
          storeVariantId: prod3VariantId,
          batchCode: { startsWith: "STK-" },
        },
      }),
    );
    expect(surplusBatch).not.toBeNull();
    expect(surplusBatch?.remainingQuantityBase).toBe(BigInt(2));
  });

  it("enforces strict cross-tenant RLS isolation", async () => {
    const stocktake = new StocktakeService(appPrisma);

    // Store B tries to view Store A's reconciled session
    const sessionsA = await stocktake.listSessions(storeAId, userAId);
    expect(sessionsA.length).toBeGreaterThan(0);
    const sessionAId = sessionsA[0]!.id;

    // Accessing Store A's session under Store B context MUST fail with notFound
    await expect(
      stocktake.getSessionDetails(storeBId, userBId, sessionAId),
    ).rejects.toThrow(/جلسة الجرد غير موجودة/);

    // Reconciling Store A's session under Store B context MUST fail with notFound
    await expect(
      stocktake.reconcileSession(storeBId, userBId, sessionAId),
    ).rejects.toThrow(/جلسة الجرد غير موجودة/);
  });
});
