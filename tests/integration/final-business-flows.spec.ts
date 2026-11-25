/**
 * The PR #40 closing flows, end to end through the route handlers (real Postgres, app role):
 *
 * - stock on credit: a 1000 purchase with 300 paid from Vodafone Cash → the wallet loses 300,
 *   the supplier is owed 700, one purchase, one payable — or nothing at all when the wallet is
 *   short;
 * - a credit sale to someone new: the customer is created inside the sale — a 500 invoice with
 *   200 paid leaves «ليك» 300, a failed sale leaves no customer, a retry no second one;
 * - a stock-in that changes the product's prices and has its own production / expiry dates.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { POST as peopleRoute } from "@/app/api/people/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
import * as purchases from "@/app/api/purchases/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as stockRoute } from "@/app/api/stock/route";
import { POST as transactionsRoute } from "@/app/api/people/[id]/transactions/route";
import { DELETE as deleteMachineRoute } from "@/app/api/machines/route";
import { POST as salesConfigRoute } from "@/app/api/sales/config/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const machines = new MachinesService(appPrisma);
const tokens = new Map<string, string>();
type Handler = (req: Request, ctx: never) => Promise<Response>;

async function call(
  handler: Handler,
  shop: Shop,
  path: string,
  body?: unknown,
  id = "",
  method = "POST",
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
    { params: Promise.resolve({ id }) } as never,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const balanceOf = async (id: string) =>
  (
    (
      await call(
        personRoute as Handler,
        A,
        `/api/people/${id}`,
        undefined,
        id,
        "GET",
      )
    ).json.person as { amount_piasters: number }
  ).amount_piasters;

describe("PR #40 closing flows", () => {
  let vodafone: string;
  let supplierId: string;
  let oil: string;

  beforeAll(async () => {
    await f.setup();
    const m = await machines.upsertMachine(A.storeId, A.userId, {
      name: "فودافون كاش",
      provider: "فودافون كاش",
    });
    vodafone = m.id;
    await machines.topupMachine(A.storeId, A.userId, vodafone, 50000);
    const s = await call(peopleRoute as Handler, A, "/api/people", {
      name: `مورد الزيت ${f.runId}`,
      section: "suppliers",
      amountEgp: "0",
    });
    expect(s.status).toBe(201);
    supplierId = (s.json.person as { id: string }).id;
    ({ variantId: oil } = await f.product(A, {
      name: "زيت",
      sell: 10000,
      buy: 8000,
    }));
  });

  afterAll(async () => {
    await f.teardown();
  });

  const walletBalance = async () =>
    (await machines.getStoreMachines(A.storeId, A.userId)).find(
      (x) => x.id === vodafone,
    )!.currentBalancePiasters;

  it("stock on credit: 1000, 300 from Vodafone Cash → wallet −300, supplier owed 700", async () => {
    const opId = crypto.randomUUID();
    const body = {
      opId,
      supplierId,
      lines: [
        { storeVariantId: oil, quantityBase: 10, totalCostPiasters: 100000 },
      ],
      paidNowPiasters: 30000,
      paidFrom: "wallet",
      paidFromMachineId: vodafone,
    };
    const r = await call(purchases.POST as Handler, A, "/api/purchases", body);
    expect(r.status).toBe(201);
    const p = r.json.purchase as {
      id: string;
      totalPiasters: number;
      paidPiasters: number;
      outstandingPiasters: number;
    };
    expect(p.totalPiasters).toBe(100000);
    expect(p.paidPiasters).toBe(30000);
    expect(p.outstandingPiasters).toBe(70000);
    expect(await walletBalance()).toBe(20000);
    expect(await balanceOf(supplierId)).toBe(70000);

    // A retry is the same purchase: no second payable, no second deduction.
    const again = await call(
      purchases.POST as Handler,
      A,
      "/api/purchases",
      body,
    );
    expect((again.json.purchase as { id: string }).id).toBe(p.id);
    expect(await walletBalance()).toBe(20000);
    expect(await balanceOf(supplierId)).toBe(70000);
    const count = await f.as(A, (tx) =>
      tx.purchase.count({ where: { storeId: A.storeId, opId } }),
    );
    expect(count).toBe(1);
  });

  it("a short wallet rolls the whole purchase back (no batch, no payable)", async () => {
    const batchesBefore = await f.as(A, (tx) =>
      tx.storeStockBatch.count({ where: { storeVariantId: oil } }),
    );
    const r = await call(purchases.POST as Handler, A, "/api/purchases", {
      opId: crypto.randomUUID(),
      supplierId,
      lines: [
        { storeVariantId: oil, quantityBase: 5, totalCostPiasters: 100000 },
      ],
      paidNowPiasters: 90000,
      paidFrom: "wallet",
      paidFromMachineId: vodafone,
    });
    expect(r.status).toBe(400);
    expect(await walletBalance()).toBe(20000);
    expect(await balanceOf(supplierId)).toBe(70000);
    const batchesAfter = await f.as(A, (tx) =>
      tx.storeStockBatch.count({ where: { storeVariantId: oil } }),
    );
    expect(batchesAfter).toBe(batchesBefore);
  });

  it("credit sale to someone new: 500 with 200 paid → «ليك» 300, one invoice, one customer", async () => {
    const name = `زبون جديد ${f.runId}`;
    const opId = crypto.randomUUID();
    const body = {
      opId,
      lines: [{ variantId: oil, quantityBase: 5 }],
      discountPiasters: 0,
      paymentMethod: "debt",
      newCustomer: { name, phone: "01011112222" },
      paidNowPiasters: 20000,
      paidFrom: "cash",
    };
    const r = await call(
      checkoutRoute as Handler,
      A,
      "/api/sales/checkout",
      body,
    );
    expect(r.status).toBe(201);
    const inv = r.json.invoice as {
      id: string;
      totalPiasters: number;
      customerId: string;
    };
    expect(inv.totalPiasters).toBe(50000);
    expect(await balanceOf(inv.customerId)).toBe(30000);

    const again = await call(
      checkoutRoute as Handler,
      A,
      "/api/sales/checkout",
      body,
    );
    expect(again.status).toBe(200);
    expect((again.json.invoice as { id: string }).id).toBe(inv.id);
    const customers = await f.as(A, (tx) =>
      tx.customer.count({ where: { storeId: A.storeId, nameAr: name } }),
    );
    expect(customers).toBe(1);
    const sales = await f.as(A, (tx) =>
      tx.sale.count({ where: { storeId: A.storeId, opId } }),
    );
    expect(sales).toBe(1);
    const debts = await f.as(A, (tx) =>
      tx.debtEntry.count({
        where: {
          storeId: A.storeId,
          customerId: inv.customerId,
          saleId: inv.id,
        },
      }),
    );
    expect(debts).toBe(2); // the invoice's debt and the payment that came with it
  });

  it("a failed credit sale leaves no customer behind", async () => {
    const name = `زبون فشل ${f.runId}`;
    const r = await call(checkoutRoute as Handler, A, "/api/sales/checkout", {
      opId: crypto.randomUUID(),
      lines: [{ variantId: oil, quantityBase: 1 }],
      discountPiasters: 0,
      paymentMethod: "debt",
      newCustomer: { name },
      paidNowPiasters: 999999,
    });
    expect(r.status).toBe(400);
    const customers = await f.as(A, (tx) =>
      tx.customer.count({ where: { storeId: A.storeId, nameAr: name } }),
    );
    expect(customers).toBe(0);
  });
  it("stock-in with new prices and its own production / expiry dates", async () => {
    const first = await call(stockRoute as Handler, A, "/api/stock", {
      action: "add",
      storeVariantId: oil,
      quantityBase: 4,
      costTotalPiasters: 32000,
      productionDate: "2026-10-01",
      expiryDate: "2027-06-01",
      paidFrom: "cash",
      opId: crypto.randomUUID(),
    });
    expect(first.status).toBe(200);
    const second = await call(stockRoute as Handler, A, "/api/stock", {
      action: "add",
      storeVariantId: oil,
      quantityBase: 6,
      costTotalPiasters: 54000,
      productionDate: "2026-11-15",
      expiryDate: "2027-12-01",
      sellPricePiasters: 11500,
      buyPricePiasters: 9000,
      paidFrom: "cash",
      opId: crypto.randomUUID(),
    });
    expect(second.status).toBe(200);
    const batches = await f.as(A, (tx) =>
      tx.storeStockBatch.findMany({
        where: { storeVariantId: oil, productionDate: { not: null } },
        orderBy: { createdAt: "asc" },
      }),
    );
    const dates = batches.map((b) => [
      b.productionDate!.toISOString().slice(0, 10),
      b.expiryDate!.toISOString().slice(0, 10),
    ]);
    expect(dates).toEqual([
      ["2026-10-01", "2027-06-01"],
      ["2026-11-15", "2027-12-01"],
    ]);
    const v = await f.as(A, (tx) =>
      tx.storeVariant.findUniqueOrThrow({ where: { id: oil } }),
    );
    expect(Number(v.sellPricePiasters)).toBe(11500);
    expect(Number(v.buyPricePiasters)).toBe(9000);

    const bad = await call(stockRoute as Handler, A, "/api/stock", {
      action: "add",
      storeVariantId: oil,
      quantityBase: 1,
      costTotalPiasters: 9000,
      productionDate: "2026-11-01",
      expiryDate: "2026-10-01",
      paidFrom: "cash",
    });
    expect(bad.status).toBe(400);
  });

  it("people payments through a wallet: a collection adds, a supplier payment takes, short = nothing", async () => {
    const before = await walletBalance();
    // The customer from the credit sale owes 300: 100 collected into Vodafone Cash.
    const customers = await f.as(A, (tx) =>
      tx.customer.findMany({
        where: { storeId: A.storeId, nameAr: { startsWith: "زبون جديد" } },
      }),
    );
    const customerId = customers[0]!.id;
    const c = await call(
      transactionsRoute as Handler,
      A,
      `/api/people/${customerId}/transactions`,
      {
        type: "payment",
        amountPiasters: 10000,
        paidFromMachineId: vodafone,
        opId: crypto.randomUUID(),
      },
      customerId,
    );
    expect(c.status).toBe(201);
    expect(await walletBalance()).toBe(before + 10000);
    expect(await balanceOf(customerId)).toBe(20000);

    // The supplier is owed 700: 200 paid from Vodafone Cash.
    const s1 = await call(
      transactionsRoute as Handler,
      A,
      `/api/people/${supplierId}/transactions`,
      {
        type: "payment",
        amountPiasters: 20000,
        paidFromMachineId: vodafone,
        opId: crypto.randomUUID(),
      },
      supplierId,
    );
    expect(s1.status).toBe(201);
    expect(await walletBalance()).toBe(before + 10000 - 20000);
    expect(await balanceOf(supplierId)).toBe(50000);

    // More than the wallet holds: 400, no entry, balances unchanged.
    const short = await call(
      transactionsRoute as Handler,
      A,
      `/api/people/${supplierId}/transactions`,
      {
        type: "payment",
        amountPiasters: 999999,
        paidFromMachineId: vodafone,
        opId: crypto.randomUUID(),
      },
      supplierId,
    );
    expect(short.status).toBe(400);
    expect(await balanceOf(supplierId)).toBe(50000);
    expect(await walletBalance()).toBe(before - 10000);
  });

  it("a machine that still has money is not deleted (409)", async () => {
    const r = await call(
      deleteMachineRoute as Handler,
      A,
      `/api/machines?id=${vodafone}`,
      undefined,
      "",
      "DELETE",
    );
    expect(r.status).toBe(409);
    expect(
      (await machines.getStoreMachines(A.storeId, A.userId)).some(
        (m) => m.id === vodafone,
      ),
    ).toBe(true);
  });

  it("a service commission: one fixed / percent value or slabs are saved; overlapping slabs are refused", async () => {
    const id = crypto.randomUUID();
    const single = await call(
      salesConfigRoute as Handler,
      A,
      "/api/sales/config",
      {
        serviceCommissions: { [id]: { type: "fixed", value: 500, tiers: [] } },
      },
    );
    // ADR-0036: one fixed amount (or one percentage) for every operation is a valid rule.
    expect(single.status).toBe(200);
    const overlap = await call(
      salesConfigRoute as Handler,
      A,
      "/api/sales/config",
      {
        serviceCommissions: {
          [id]: {
            type: "fixed",
            value: 0,
            tiers: [
              {
                fromPiasters: 10000,
                toPiasters: 100000,
                type: "fixed",
                value: 500,
              },
              {
                fromPiasters: 90000,
                toPiasters: 1000000,
                type: "percent",
                value: 2,
              },
            ],
          },
        },
      },
    );
    expect(overlap.status).toBe(400);
    const ok = await call(salesConfigRoute as Handler, A, "/api/sales/config", {
      serviceCommissions: {
        [id]: {
          type: "fixed",
          value: 0,
          tiers: [
            {
              fromPiasters: 10000,
              toPiasters: 100000,
              type: "fixed",
              value: 500,
            },
            {
              fromPiasters: 100000,
              toPiasters: 1000000,
              type: "percent",
              value: 2,
            },
          ],
        },
      },
    });
    expect(ok.status).toBe(200);
  });
});
