/**
 * QA-10 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0022) — undo is a reversing void, never a delete:
 * the sale stays recorded and is marked void, exactly what it took goes back to the same
 * batches, it is no longer revenue, a second void restores nothing, and another store cannot
 * see or void it. One transaction: no partial success.
 *
 * Real Postgres, real route handlers, real sessions, app role with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { InventoryService } from "@/server/modules/inventory";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { POST as createSandwichRoute } from "@/app/api/sandwiches/route";
import { POST as topupRoute } from "@/app/api/machines/topup/route";
import { GET as reportRoute } from "@/app/api/reports/home/route";
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

interface Voided {
  saleId: string;
  alreadyVoided: boolean;
  stock: Array<{ variantId: string; stockAfterBase: number }>;
  machine?: { machineId: string; balanceAfterPiasters: number };
}

const saleIdOf = (res: { json: Json }) => (res.json.data as { id: string }).id;

async function consistent(shop: Shop, variantId: string) {
  const s = await f.stockState(shop, variantId);
  expect(s.level).toBe(s.movementsSum);
  expect(s.batchesRemaining).toBe(s.movementsSum);
  const [row] = await inventory.getStockReconciliation(
    shop.storeId,
    shop.userId,
    { variantId },
  );
  expect(row?.consistent).toBe(true);
  return s;
}

async function listed(shop: Shop) {
  const res = await f.request(shop, "GET");
  return res.json as {
    sales: Array<{ id: string; voided: boolean; amountPiasters: number }>;
    todayTotalPiasters: number;
    todayCount: number;
  };
}

async function report(shop: Shop) {
  const res = await call(
    reportRoute,
    shop,
    "GET",
    "/api/reports/home?period=today",
  );
  expect(res.status).toBe(200);
  return parseHomeReport(res.json);
}

beforeAll(() => f.setup());
afterAll(async () => {
  const ids = [A.storeId, B.storeId];
  await f.sql`DELETE FROM "pos_machine_topups" WHERE store_id IN ${f.sql(ids)}`;
  await f.sql`DELETE FROM "pos_machines" WHERE store_id IN ${f.sql(ids)}`;
  await f.teardown();
});

describe("QA-10 — void an ordinary sale", () => {
  it("keeps the sale, marks it void, and puts back exactly what it took, to the same batches", async () => {
    const cola = await f.product(A, { name: "كولا إلغاء", sell: 1250 });
    // FEFO: the sale takes 4 from the earlier batch and 1 from the later one.
    await f.addStock(A, cola.variantId, 4, { expiry: "2027-01-01" });
    await f.addStock(A, cola.variantId, 6, { expiry: "2027-06-01" });
    const before = await consistent(A, cola.variantId);
    expect(before.batches).toEqual([4, 6]);

    const sale = await f.sell(A, cola.variantId, 5);
    expect(sale.status).toBe(200);
    const saleId = saleIdOf(sale);
    expect((await consistent(A, cola.variantId)).batches).toEqual([0, 5]);

    // Things that happen after the sale must not change what the void restores.
    await f.as(A, (tx) =>
      tx.storeVariant.update({
        where: { id: cola.variantId },
        data: { sellPricePiasters: BigInt(9999) },
      }),
    );
    await f.addStock(A, cola.variantId, 3, { expiry: "2026-12-01" });
    const totalBefore = (await listed(A)).todayTotalPiasters;

    const res = await f.void(A, { saleId, opId: crypto.randomUUID() });
    expect(res.status).toBe(200);
    const data = res.json.data as Voided;
    expect(data).toMatchObject({ saleId, alreadyVoided: false });
    expect(data.stock).toEqual([
      { variantId: cola.variantId, stockAfterBase: 13 },
    ]);

    const after = await consistent(A, cola.variantId);
    // The new batch (expiry 2026-12-01) sorts first; the two original batches are back to 4 and 6.
    expect(after.batches).toEqual([3, 4, 6]);
    expect(after.level).toBe(13);
    const voids = after.movements.filter((m) => m.type === "sale_void");
    expect(voids.map((m) => m.quantity).sort()).toEqual([1, 4]);

    // The sale, its line and its original movements are still there.
    const [row] = (await f.salesOf(A)).filter((s) => s.id === saleId);
    expect(row).toBeDefined();
    expect(Number(row!.totalPiasters)).toBe(6250);
    expect(row!.saleLines).toHaveLength(1);
    expect(row!.saleVoid?.voidedBy).toBe(A.userId);
    expect(after.movements.filter((m) => m.type === "sale")).toHaveLength(2);

    // Listed for the record, flagged void, and no longer revenue.
    const list = await listed(A);
    expect(list.sales.find((s) => s.id === saleId)).toMatchObject({
      voided: true,
      amountPiasters: 6250,
    });
    expect(list.todayTotalPiasters).toBe(totalBefore - 6250);
  });

  it("a second void restores nothing: same opId, or a new one", async () => {
    const p = await f.product(A, { name: "مياه إلغاء", sell: 500 });
    await f.addStock(A, p.variantId, 5);
    const saleId = saleIdOf(await f.sell(A, p.variantId, 2));
    const opId = crypto.randomUUID();
    const first = await f.void(A, { saleId, opId });
    expect((first.json.data as Voided).alreadyVoided).toBe(false);

    const retry = await f.void(A, { saleId, opId });
    expect(retry.status).toBe(200);
    expect(retry.json.data as Voided).toMatchObject({
      saleId,
      alreadyVoided: true,
    });
    const again = await f.void(A, { saleId, opId: crypto.randomUUID() });
    expect(again.status).toBe(200);
    expect((again.json.data as Voided).alreadyVoided).toBe(true);

    const s = await consistent(A, p.variantId);
    expect(s.level).toBe(5);
    expect(s.movements.filter((m) => m.type === "sale_void")).toHaveLength(1);
    const rows = await f.as(A, (tx) =>
      tx.saleVoid.findMany({ where: { storeId: A.storeId, saleId } }),
    );
    expect(rows).toHaveLength(1);
  });

  it("two voids at the same time: exactly one restores the stock", async () => {
    const p = await f.product(A, { name: "عصير سباق", sell: 700 });
    await f.addStock(A, p.variantId, 4);
    const saleId = saleIdOf(await f.sell(A, p.variantId, 3));
    const results = await Promise.all(
      [1, 2, 3].map(() => f.void(A, { saleId, opId: crypto.randomUUID() })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(
      results.filter((r) => !(r.json.data as Voided).alreadyVoided),
    ).toHaveLength(1);
    const s = await consistent(A, p.variantId);
    expect(s.level).toBe(4);
    expect(s.movements.filter((m) => m.type === "sale_void")).toHaveLength(1);
  });

  it("after a void the stock can be sold again", async () => {
    const p = await f.product(A, { name: "بسكوت آخر قطعة", sell: 300 });
    await f.addStock(A, p.variantId, 1);
    const saleId = saleIdOf(await f.sell(A, p.variantId, 1));
    expect((await f.sell(A, p.variantId, 1)).status).toBe(409);
    expect((await f.void(A, { saleId })).status).toBe(200);
    expect((await f.sell(A, p.variantId, 1)).status).toBe(200);
    expect((await consistent(A, p.variantId)).level).toBe(0);
  });

  it("an unknown sale is 404, a malformed id is 400, an opId of another void is 409", async () => {
    const unknown = await f.void(A, { saleId: crypto.randomUUID() });
    expect(unknown.status).toBe(404);
    const bad = await f.void(A, { saleId: "not-a-uuid" });
    expect(bad.status).toBe(400);

    const p = await f.product(A, { name: "شاي عمليات", sell: 400 });
    await f.addStock(A, p.variantId, 3);
    const s1 = saleIdOf(await f.sell(A, p.variantId, 1));
    const s2 = saleIdOf(await f.sell(A, p.variantId, 1));
    const opId = crypto.randomUUID();
    expect((await f.void(A, { saleId: s1, opId })).status).toBe(200);
    const clash = await f.void(A, { saleId: s2, opId });
    expect(clash.status).toBe(409);
    expect((await consistent(A, p.variantId)).level).toBe(2);
  });

  it("another store cannot void (or see) the sale", async () => {
    const p = await f.product(A, { name: "زيت عزل", sell: 6000 });
    await f.addStock(A, p.variantId, 2);
    const saleId = saleIdOf(await f.sell(A, p.variantId, 1));
    const res = await f.void(B, { saleId });
    expect(res.status).toBe(404);
    expect((await consistent(A, p.variantId)).level).toBe(1);
    const [row] = (await f.salesOf(A)).filter((s) => s.id === saleId);
    expect(row!.saleVoid).toBeNull();
    // A void row cannot be written for another store's sale, even bypassing the service.
    await expect(
      f.as(B, (tx) =>
        tx.saleVoid.create({
          data: { storeId: B.storeId, saleId, opId: crypto.randomUUID() },
        }),
      ),
    ).rejects.toThrow();
  });

  it("the app role cannot change or delete a void (append-only)", async () => {
    const p = await f.product(A, { name: "سكر سجل", sell: 2500 });
    await f.addStock(A, p.variantId, 2);
    const saleId = saleIdOf(await f.sell(A, p.variantId, 1));
    expect((await f.void(A, { saleId })).status).toBe(200);
    const { withTenant } = await import("@/server/infra/db/tenant");
    await expect(
      withTenant(A.storeId, A.userId, (tx) =>
        tx.saleVoid.deleteMany({ where: { storeId: A.storeId, saleId } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(A.storeId, A.userId, (tx) =>
        tx.saleVoid.updateMany({
          where: { storeId: A.storeId, saleId },
          data: { reason: "x" },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("QA-10 — void other kinds of sale", () => {
  it("a sandwich sale: every ingredient goes back exactly", async () => {
    const bread = await f.product(A, { name: "عيش إلغاء", sell: 400 });
    const cheese = await f.product(A, {
      name: "جبنة إلغاء",
      unit: "kg",
      sell: 20000,
    });
    await f.addStock(A, bread.variantId, 10, { cost: 3000 });
    await f.addStock(A, cheese.variantId, 1000, { cost: 16000 });
    const sw = await call(createSandwichRoute, A, "POST", "/api/sandwiches", {
      name: `ساندوتش إلغاء ${f.runId}`,
      sellPricePiasters: 1500,
      ingredients: [
        { variantId: bread.variantId, quantity: 1, unit: "piece" },
        { variantId: cheese.variantId, quantity: 50, unit: "g" },
      ],
    });
    expect(sw.status).toBe(201);
    const swId = (sw.json.sandwich as { id: string }).id;
    const sale = await f.request(A, "POST", {
      productId: swId,
      quantityBase: 3,
      opId: crypto.randomUUID(),
    });
    expect(sale.status).toBe(200);
    expect((await consistent(A, bread.variantId)).level).toBe(7);
    expect((await consistent(A, cheese.variantId)).level).toBe(850);

    const res = await f.void(A, { saleId: saleIdOf(sale) });
    expect(res.status).toBe(200);
    expect((await consistent(A, bread.variantId)).level).toBe(10);
    expect((await consistent(A, cheese.variantId)).level).toBe(1000);
  });

  it("a promotion sale: every item goes back", async () => {
    const chips = await f.product(A, { name: "شيبسي إلغاء", sell: 500 });
    const pepsi = await f.product(A, { name: "بيبسي إلغاء", sell: 1000 });
    await f.addStock(A, chips.variantId, 5);
    await f.addStock(A, pepsi.variantId, 2);
    const promoId = `promo-${crypto.randomUUID()}`;
    await f.as(A, (tx) =>
      tx.store.update({
        where: { id: A.storeId },
        data: {
          settings: {
            activePromotions: [
              {
                id: promoId,
                title: "كومبو إلغاء",
                type: "bundle",
                items: [
                  {
                    productId: chips.productId,
                    variantId: chips.variantId,
                    productName: "شيبسي",
                    quantityBase: 2,
                    unit: "piece",
                    regularPricePiasters: 500,
                  },
                  {
                    productId: pepsi.productId,
                    variantId: pepsi.variantId,
                    productName: "بيبسي",
                    quantityBase: 1,
                    unit: "piece",
                    regularPricePiasters: 1000,
                  },
                ],
                originalPricePiasters: 2000,
                promoPricePiasters: 1500,
                savingsPiasters: 500,
                createdAt: Date.now(),
              },
            ],
          },
        },
      }),
    );
    const sale = await f.request(A, "POST", {
      promotionId: promoId,
      opId: crypto.randomUUID(),
    });
    expect(sale.status).toBe(200);
    expect((await consistent(A, chips.variantId)).level).toBe(3);
    const res = await f.void(A, { saleId: saleIdOf(sale) });
    expect(res.status).toBe(200);
    expect((await consistent(A, chips.variantId)).level).toBe(5);
    expect((await consistent(A, pepsi.variantId)).level).toBe(2);
  });

  it("a service paid through a POS machine: the machine gets its charge back", async () => {
    const m = await f.as(A, (tx) =>
      tx.posMachine.create({
        data: {
          storeId: A.storeId,
          name: `ماكينة إلغاء ${f.runId}`,
          provider: "fawry",
        },
        select: { id: true },
      }),
    );
    const top = await call(topupRoute, A, "POST", "/api/machines/topup", {
      machineId: m.id,
      amountPiasters: 50_000,
    });
    expect(top.status).toBe(200);
    const svc = await f.product(A, {
      name: "شحن إلغاء",
      sell: 500,
      category: "شحن رصيد",
    });
    const sale = await f.request(A, "POST", {
      productId: svc.productId,
      amountPiasters: 10_500,
      machineId: m.id,
      machineDeductPiasters: 10_000,
      opId: crypto.randomUUID(),
    });
    expect(sale.status).toBe(200);
    const res = await f.void(A, { saleId: saleIdOf(sale) });
    expect(res.status).toBe(200);
    expect((res.json.data as Voided).machine).toEqual({
      machineId: m.id,
      balanceAfterPiasters: 50_000,
    });
    const balance = await f.as(A, (tx) =>
      tx.posMachine.findUniqueOrThrow({ where: { id: m.id } }),
    );
    expect(Number(balance.currentBalancePiasters)).toBe(50_000);
    // A second void does not refund twice.
    expect((await f.void(A, { saleId: saleIdOf(sale) })).status).toBe(200);
    const again = await f.as(A, (tx) =>
      tx.posMachine.findUniqueOrThrow({ where: { id: m.id } }),
    );
    expect(Number(again.currentBalancePiasters)).toBe(50_000);
  });

  it("the Home report leaves a voided sale out of revenue and cost", async () => {
    const shop = B; // a store with no other sales today in this file
    const p = await f.product(shop, { name: "تقرير إلغاء", sell: 1000 });
    await f.addStock(shop, p.variantId, 5, { cost: 2500 });
    const kept = await f.sell(shop, p.variantId, 1);
    const undone = await f.sell(shop, p.variantId, 2);
    expect(kept.status).toBe(200);
    const before = await report(shop);
    expect(before.sales.revenuePiasters).toBe(3000);
    expect((await f.void(shop, { saleId: saleIdOf(undone) })).status).toBe(200);
    const after = await report(shop);
    expect(after.sales).toMatchObject({
      count: 1,
      revenuePiasters: 1000,
      cogsPiasters: 500,
      grossProfitPiasters: 500,
    });
    const list = await listed(shop);
    expect(list.todayTotalPiasters).toBe(1000);
    expect(list.todayCount).toBe(1);
  });
});
