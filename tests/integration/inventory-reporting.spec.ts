/**
 * QA-05 / QA-06 / QA-07 / QA-08 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0021) on a real Postgres:
 * - QA-05: every stock mutation keeps  stock_levels = Σ batch remaining = Σ ledger;
 *   adjustments and waste take from batches; a stale cache is corrected by the next write;
 *   the reconciliation check reports mismatches.
 * - QA-08: a batch stores the total paid and the unit cost per selling unit; purchases,
 *   FEFO costs and movement costs follow from the total (the audit's 380.00, not 4,264).
 * - QA-06 / QA-07: the Home report shows the real sales and expenses, and COGS / profit only
 *   from recorded costs ("unknown" when not recorded) — parsed by the client's own parser.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { createSession } from "@/server/modules/auth";
import { InventoryService } from "@/server/modules/inventory";
import { CatalogService } from "@/server/modules/catalog";
import { GET as reportRoute } from "@/app/api/reports/home/route";
import {
  GET as stockGetRoute,
  POST as stockPostRoute,
} from "@/app/api/stock/route";
import { POST as createSandwichRoute } from "@/app/api/sandwiches/route";
import { POST as createExpenseRoute } from "@/app/api/expenses/route";
import { parseHomeReport } from "@/client/shared/api/reports";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const inventory = new InventoryService(appPrisma);

const tokens = new Map<string, string>();
async function call(
  handler: (req: Request) => Promise<Response>,
  shop: Shop,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  let token = tokens.get(shop.storeId);
  if (!token) {
    token = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, token);
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

async function reconcile(shop: Shop, variantId: string) {
  const [row] = await inventory.getStockReconciliation(
    shop.storeId,
    shop.userId,
    { variantId },
  );
  return row!;
}

async function expectReconciled(shop: Shop, variantId: string, qty: number) {
  const r = await reconcile(shop, variantId);
  expect(r).toMatchObject({
    levelBase: qty,
    batchesRemainingBase: qty,
    ledgerBase: qty,
    consistent: true,
  });
}

async function batchesOf(shop: Shop, variantId: string) {
  return f.as(shop, (tx) =>
    tx.storeStockBatch.findMany({
      where: { storeId: shop.storeId, storeVariantId: variantId },
      orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
    }),
  );
}

async function report(shop: Shop, period = "today") {
  const res = await call(
    reportRoute,
    shop,
    "GET",
    `/api/reports/home?period=${period}`,
  );
  expect(res.status).toBe(200);
  // The client's own parser: if the server and Home disagree on a field, this throws.
  return parseHomeReport(res.json);
}

beforeAll(() => f.setup());
afterAll(async () => {
  const ids = [A.storeId, B.storeId];
  await f.sql`DELETE FROM "sandwich_ingredients" WHERE store_id IN ${f.sql(ids)}`;
  await f.sql`DELETE FROM "expenses" WHERE store_id IN ${f.sql(ids)}`;
  await f.teardown();
});

describe("QA-05 — one source of truth for stock quantities", () => {
  it("keeps level = batches = ledger through every mutation path", async () => {
    const p = await f.product(A, { name: "مسار", sell: 1000, buy: 600 });
    const v = p.variantId;
    const b1 = await f.addStock(A, v, 10, { expiry: "2027-01-01", cost: 6000 });
    await f.addStock(A, v, 10, { expiry: "2027-06-01", cost: 7000 });
    await expectReconciled(A, v, 20);

    expect((await f.sell(A, v, 3)).status).toBe(200); // sale
    await expectReconciled(A, v, 17);
    await inventory.recordWaste(A.storeId, A.userId, {
      storeVariantId: v,
      quantityBase: 2,
    }); // waste, no batch → FEFO
    await expectReconciled(A, v, 15);
    await inventory.recordWaste(A.storeId, A.userId, {
      storeVariantId: v,
      quantityBase: 1,
      batchId: b1.batchId!,
    }); // waste from a chosen batch
    await expectReconciled(A, v, 14);
    await f.adjust(A, v, -4); // adjust delta down
    await expectReconciled(A, v, 10);
    await f.adjust(A, v, 5); // adjust delta up
    await expectReconciled(A, v, 15);
    await inventory.adjustStockQuantity(A.storeId, A.userId, {
      storeVariantId: v,
      mode: "set",
      targetQuantityBase: 9,
    }); // adjust set down
    await expectReconciled(A, v, 9);
    // Beyond the stock is rejected, never floored (QA-16): nothing changes.
    await expect(f.adjust(A, v, -100)).rejects.toThrow(/سالبة/);
    await expectReconciled(A, v, 9);
    await f.adjust(A, v, -9); // exactly what is there
    await expectReconciled(A, v, 0);
    const b3 = await f.addStock(A, v, 6, { cost: 600 });
    await expectReconciled(A, v, 6);
    await inventory.voidStockBatch(A.storeId, A.userId, {
      batchId: b3.batchId!,
    }); // void
    await expectReconciled(A, v, 0);
    await f.addStock(A, v, 4, { cost: 400 });
    await inventory.adjustStockQuantity(A.storeId, A.userId, {
      storeVariantId: v,
      mode: "set",
      targetQuantityBase: 0,
    }); // adjusted to 0
    await expectReconciled(A, v, 0);
  });

  it("a decreasing adjustment takes from the batches FEFO, one movement per batch", async () => {
    const p = await f.product(A, { name: "تسوية", sell: 500 });
    const early = await f.addStock(A, p.variantId, 3, {
      expiry: "2027-01-01",
      cost: 300,
    });
    const late = await f.addStock(A, p.variantId, 5, {
      expiry: "2027-12-01",
      cost: 1000,
    });
    await f.adjust(A, p.variantId, -4);
    const batches = await batchesOf(A, p.variantId);
    expect(batches.map((b) => [b.id, Number(b.remainingQuantityBase)])).toEqual(
      [
        [early.batchId, 0],
        [late.batchId, 4],
      ],
    );
    const s = await f.stockState(A, p.variantId);
    const adj = s.movements.filter((m) => m.type === "adjustment");
    // Per batch (movements of one transaction share a timestamp, so their order is not fixed):
    // 3 from the earliest-expiring batch, then 1 from the later one.
    expect(Object.fromEntries(adj.map((m) => [m.batchId, m.quantity]))).toEqual(
      {
        [String(early.batchId)]: -3,
        [String(late.batchId)]: -1,
      },
    );
    await expectReconciled(A, p.variantId, 4);
  });

  it("refuses waste above the stock or above the chosen batch, changing nothing", async () => {
    const p = await f.product(A, { name: "هالك", sell: 500 });
    const b = await f.addStock(A, p.variantId, 3, { cost: 300 });
    await f.addStock(A, p.variantId, 2, { cost: 200 });
    const before = await f.stockState(A, p.variantId);
    await expect(
      inventory.recordWaste(A.storeId, A.userId, {
        storeVariantId: p.variantId,
        quantityBase: 6,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      inventory.recordWaste(A.storeId, A.userId, {
        storeVariantId: p.variantId,
        quantityBase: 4,
        batchId: b.batchId!,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await f.stockState(A, p.variantId)).toEqual(before);
  });

  it("the waste cost is its share of the batch total", async () => {
    const p = await f.product(A, { name: "تكلفة هالك", sell: 500 });
    await f.addStock(A, p.variantId, 4, { cost: 1000 }); // 2.50 each
    const res = await inventory.recordWaste(A.storeId, A.userId, {
      storeVariantId: p.variantId,
      quantityBase: 2,
    });
    const w = await f.as(A, (tx) =>
      tx.wasteRecord.findUniqueOrThrow({ where: { id: res.wasteId! } }),
    );
    expect(Number(w.costMinor)).toBe(500);
  });

  it("detects a stale cache, and the next write corrects it from the ledger", async () => {
    const p = await f.product(A, { name: "كاش", sell: 500 });
    await f.addStock(A, p.variantId, 10, { cost: 1000 });
    await f.sql`UPDATE stock_levels SET quantity_base = 999
                WHERE store_variant_id = ${p.variantId}::uuid`;
    expect((await reconcile(A, p.variantId)).consistent).toBe(false);
    const viaApi = await call(
      stockGetRoute,
      A,
      "GET",
      `/api/stock?view=reconcile&variantId=${p.variantId}`,
    );
    expect(viaApi.json.consistent).toBe(false);

    // Availability comes from the ledger (10), not from the stale cache (999).
    expect((await f.sell(A, p.variantId, 11)).status).toBe(409);
    expect((await f.sell(A, p.variantId, 2)).status).toBe(200);
    await expectReconciled(A, p.variantId, 8);
  });

  it("reconciliation is scoped to the signed-in store", async () => {
    const pb = await f.product(B, { name: "محل ب", sell: 500 });
    await f.addStock(B, pb.variantId, 2, { cost: 200 });
    const rowsA = await inventory.getStockReconciliation(A.storeId, A.userId);
    expect(rowsA.some((r) => r.variantId === pb.variantId)).toBe(false);
    const rowsB = await inventory.getStockReconciliation(B.storeId, B.userId);
    expect(rowsB.every((r) => r.consistent)).toBe(true);
  });
});

describe("QA-08 — batch cost semantics", () => {
  it("the audit example: 20 cola 160.00, 20 bread 60.00, 1000 g cheese 160.00 → purchases 380.00", async () => {
    const shop = B;
    const cola = await f.product(shop, { name: "كولا 380", sell: 1000 });
    const bread = await f.product(shop, { name: "عيش 380", sell: 400 });
    const cheese = await f.product(shop, {
      name: "جبنة 380",
      unit: "kg",
      sell: 20000,
    });
    const before = (await report(shop)).purchases.totalPiasters;
    for (const [v, qty, total] of [
      [cola.variantId, 20, 16000],
      [bread.variantId, 20, 6000],
      [cheese.variantId, 1000, 16000],
    ] as const) {
      const res = await call(stockPostRoute, shop, "POST", "/api/stock", {
        action: "add",
        storeVariantId: v,
        quantityBase: qty,
        costTotalPiasters: total,
      });
      expect(res.status).toBe(200);
    }
    const unit = async (v: string) =>
      (await batchesOf(shop, v)).map((b) => [
        Number(b.costPriceMinor),
        Number(b.costTotalMinor),
      ]);
    expect(await unit(cola.variantId)).toEqual([[800, 16000]]);
    expect(await unit(bread.variantId)).toEqual([[300, 6000]]);
    expect(await unit(cheese.variantId)).toEqual([[16000, 16000]]); // per kg
    const after = (await report(shop)).purchases.totalPiasters;
    expect(after - before).toBe(38000); // 380.00 — never 4,264
  });

  it("accepts the legacy field name as the total the Add-Stock screen always sent", async () => {
    const p = await f.product(A, { name: "قديم", sell: 1000 });
    const res = await call(stockPostRoute, A, "POST", "/api/stock", {
      action: "add",
      storeVariantId: p.variantId,
      quantityBase: 4,
      costPricePiasters: 2000,
    });
    expect(res.status).toBe(200);
    const [b] = await batchesOf(A, p.variantId);
    expect([Number(b!.costPriceMinor), Number(b!.costTotalMinor)]).toEqual([
      500, 2000,
    ]);
  });

  it("a sale records the cost of what it consumed (FEFO, proportional, across batches)", async () => {
    const p = await f.product(A, { name: "فيفو", sell: 1000 });
    await f.addStock(A, p.variantId, 3, { expiry: "2027-01-01", cost: 1000 }); // 3 for 10.00
    await f.addStock(A, p.variantId, 10, { expiry: "2027-12-01", cost: 5000 }); // 5.00 each
    const res = await f.sell(A, p.variantId, 5); // 3 from the first (10.00) + 2 × 5.00
    const id = (res.json.data as { id: string }).id;
    const [sale] = (await f.salesOf(A)).filter((s) => s.id === id);
    expect(Number(sale!.saleLines[0]!.costPiasters)).toBe(2000);

    const cheese = await f.product(A, {
      name: "جبنة فيفو",
      unit: "kg",
      sell: 20000,
    });
    await f.addStock(A, cheese.variantId, 1000, { cost: 16000 });
    const r2 = await f.sell(A, cheese.variantId, 250);
    const id2 = (r2.json.data as { id: string }).id;
    const [s2] = (await f.salesOf(A)).filter((s) => s.id === id2);
    expect(Number(s2!.saleLines[0]!.costPiasters)).toBe(4000); // 250 g of 160.00/kg
  });

  it("the movement log shows each movement's own share of the batch cost", async () => {
    const p = await f.product(A, { name: "سجل", sell: 1000 });
    await f.addStock(A, p.variantId, 10, { cost: 3000 });
    await f.sell(A, p.variantId, 4);
    const movements = await inventory.getStockMovements(A.storeId, A.userId, {
      variantId: p.variantId,
    });
    const byType = Object.fromEntries(
      movements.map((m) => [m.type, m.costTotalMinor]),
    );
    expect(byType).toEqual({ purchase: 3000, sale: 1200 });
  });

  it("initial stock and stock increases are costed from the registered buy price per selling unit", async () => {
    const catalog = new CatalogService(appPrisma);
    const created = await catalog.upsertStoreProduct(A.storeId, A.userId, {
      nameAr: `لانشون ${f.runId}`,
      category: "لحوم",
      unit: "kg",
      sellPricePiasters: 26000,
      buyCostPiasters: 20000,
      initialQuantity: 500,
      isCustom: true,
      variants: [
        { packQty: 1, sellPricePiasters: 26000, costPricePiasters: 20000 },
      ],
    });
    const v = created.variants[0]!.id;
    const [initial] = await batchesOf(A, v);
    expect([
      Number(initial!.costPriceMinor),
      Number(initial!.costTotalMinor),
    ]).toEqual([20000, 10000]); // 500 g at 200.00/kg = 100.00 (it used to be 500 × 20000)

    const noPrice = await f.product(A, { name: "بدون سعر", sell: 500 });
    await f.adjust(A, noPrice.variantId, 3);
    const [adj] = await batchesOf(A, noPrice.variantId);
    expect([adj!.costPriceMinor, adj!.costTotalMinor]).toEqual([null, null]); // unknown, not 0
  });
});

describe("QA-06 / QA-07 — the Home report", () => {
  it("shows the real sales and expenses (two sandwiches = 30.00, expense 123.45)", async () => {
    const shop = f.shopA;
    const base = await report(shop);
    const bread = await f.product(shop, {
      name: "عيش ساندوتش",
      sell: 400,
      buy: 300,
    });
    const cheese = await f.product(shop, {
      name: "جبنة ساندوتش",
      unit: "kg",
      sell: 20000,
      buy: 16000,
    });
    await f.addStock(shop, bread.variantId, 10, { cost: 3000 });
    await f.addStock(shop, cheese.variantId, 1000, { cost: 16000 });
    const sw = await call(
      createSandwichRoute,
      shop,
      "POST",
      "/api/sandwiches",
      {
        name: `ساندوتش تقرير ${f.runId}`,
        sellPricePiasters: 1500,
        ingredients: [
          { variantId: bread.variantId, quantity: 1, unit: "piece" },
          { variantId: cheese.variantId, quantity: 50, unit: "g" },
        ],
      },
    );
    expect(sw.status).toBe(201);
    const swId = (sw.json.sandwich as { id: string; costPiasters: number }).id;
    const swCost = (sw.json.sandwich as { costPiasters: number }).costPiasters; // 3.00 + 8.00
    expect(swCost).toBe(1100);
    for (let i = 0; i < 2; i++) {
      const res = await f.request(shop, "POST", {
        productId: swId,
        quantityBase: 1,
        opId: crypto.randomUUID(),
      });
      expect(res.status).toBe(200);
    }
    const exp = await call(createExpenseRoute, shop, "POST", "/api/expenses", {
      category: "كهرباء",
      amountPiasters: 12345,
    });
    expect(exp.status).toBe(201);

    const r = await report(shop);
    expect(r.sales.count - base.sales.count).toBe(2);
    expect(r.sales.revenuePiasters - base.sales.revenuePiasters).toBe(3000);
    expect(r.expenses.totalPiasters - base.expenses.totalPiasters).toBe(12345);
    // Recorded sandwich cost snapshots: 2 × 11.00
    expect(r.sales.knownCostPiasters - base.sales.knownCostPiasters).toBe(2200);
    const swRow = r.topProducts.find((p) => p.productId === swId)!;
    expect(swRow).toMatchObject({
      quantityBase: 2,
      revenuePiasters: 3000,
      grossProfitPiasters: 800,
    });
    expect(
      r.activity.filter(
        (a) => a.kind === "expense" && a.amountPiasters === -12345,
      ),
    ).toHaveLength(1);
    // The hourly series adds up to the revenue.
    expect(r.series.points.reduce((t, p) => t + p.revenuePiasters, 0)).toBe(
      r.sales.revenuePiasters,
    );
  });

  it("known costs give COGS and gross profit; an unknown cost makes them unknown (no 75% / 25%)", async () => {
    const shop = f.shopB;
    const base = await report(shop);
    const known = await f.product(shop, { name: "معروف", sell: 1000 });
    await f.addStock(shop, known.variantId, 10, { cost: 6000 }); // 6.00 each
    await f.sell(shop, known.variantId, 2); // revenue 20.00, cost 12.00
    const mid = await report(shop);
    expect(mid.sales.cogsPiasters).not.toBeNull();
    expect(mid.sales.cogsPiasters! - (base.sales.cogsPiasters ?? 0)).toBe(1200);
    expect(mid.sales.grossProfitPiasters).toBe(
      mid.sales.revenuePiasters - mid.sales.cogsPiasters!,
    );

    // Stock with no recorded cost (an increase without a registered buy price) is sold.
    const unknown = await f.product(shop, { name: "مجهول", sell: 1000 });
    await f.adjust(shop, unknown.variantId, 5);
    const res = await f.sell(shop, unknown.variantId, 1);
    const [sale] = (await f.salesOf(shop)).filter(
      (s) => s.id === (res.json.data as { id: string }).id,
    );
    expect(sale!.saleLines[0]!.costPiasters).toBeNull();

    const r = await report(shop);
    expect(r.sales.cogsPiasters).toBeNull();
    expect(r.sales.grossProfitPiasters).toBeNull();
    expect(r.sales.unknownCostCount).toBe(1);
    // Nothing fabricated: the known part is reported as recorded, nothing for the rest.
    expect(r.sales.knownCostPiasters).toBe(mid.sales.cogsPiasters);
    const row = r.topProducts.find((p) => p.productId === unknown.productId)!;
    expect(row.grossProfitPiasters).toBeNull();
  });

  it("each store sees only its own report", async () => {
    const a = await report(f.shopA, "all");
    const b = await report(f.shopB, "all");
    const aIds = new Set(a.activity.map((x) => x.id));
    expect(b.activity.some((x) => aIds.has(x.id))).toBe(false);
  });

  it("rejects nothing on an unknown period: it falls back to today", async () => {
    const r = await report(f.shopA, "bogus");
    expect(r.period).toBe("today");
  });
});
