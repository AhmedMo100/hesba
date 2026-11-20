/**
 * The cash drawer to the piaster (ADR-0031): every kind of money movement after a count is
 * made through the real routes, and `GET /api/drawer`'s expected amount, cash in / out, the
 * per-kind totals and the movement list all equal the hand-made sum. Wallet money never
 * counts, a supplier invoice's batch is not counted twice, and closing the drawer records the
 * server's own difference once (a double submit, a repeated close, two closes at once).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { ExpenseService } from "@/server/modules/expenses";
import {
  DRAWER_TOPUP_SOURCE,
  getDrawer,
  recordDrawerCount,
} from "@/server/modules/drawer";
import { GET as drawerGet, POST as drawerPost } from "@/app/api/drawer/route";
import { POST as peopleRoute } from "@/app/api/people/route";
import { POST as transactionsRoute } from "@/app/api/people/[id]/transactions/route";
import * as purchases from "@/app/api/purchases/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import { POST as stockRoute } from "@/app/api/stock/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const machines = new MachinesService(appPrisma);
const expenses = new ExpenseService(appPrisma);
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

type Invoice = {
  id: string;
  totalPiasters: number;
  lines: Array<{ id: string }>;
};
const checkout = async (body: Json) => {
  const r = await call(checkoutRoute as Handler, A, "/api/sales/checkout", {
    opId: crypto.randomUUID(),
    discountPiasters: 0,
    paidNowPiasters: 0,
    ...body,
  });
  expect(r.status).toBe(201);
  return r.json.invoice as Invoice;
};

describe("the drawer to the piaster", () => {
  let item: string;
  let machineId: string;
  let supplierId: string;

  beforeAll(async () => {
    await f.setup();
    ({ variantId: item } = await f.product(A, {
      name: "صنف الدرج",
      sell: 1250,
      buy: 900,
    }));
    const st = await call(stockRoute as Handler, A, "/api/stock", {
      action: "add",
      storeVariantId: item,
      quantityBase: 50,
      costTotalPiasters: 45000,
      paidFrom: "wallet",
      opId: crypto.randomUUID(),
    });
    expect(st.status).toBe(200);
    const m = await machines.upsertMachine(A.storeId, A.userId, {
      name: "فوري",
      provider: "فوري",
    });
    machineId = m.id;
    await machines.topupMachine(A.storeId, A.userId, machineId, 100000, {
      source: "شحن",
    });
    const s = await call(peopleRoute as Handler, A, "/api/people", {
      name: `مورد الدرج ${f.runId}`,
      section: "suppliers",
      amountEgp: "0",
    });
    supplierId = (s.json.person as { id: string }).id;
    // The opening count: 1,000.00.
    await recordDrawerCount(A.storeId, A.userId, {
      opId: crypto.randomUUID(),
      countedPiasters: 100000,
    });
  });

  afterAll(async () => {
    await f.teardown();
  });

  it("every movement since the count, summed exactly", async () => {
    // +37.50: a cash sale of 3 × 12.50.
    const cashSale = await checkout({
      lines: [{ variantId: item, quantityBase: 3 }],
      paymentMethod: "cash",
    });
    expect(cashSale.totalPiasters).toBe(3750);
    // Not the drawer: a wallet sale.
    await checkout({
      lines: [{ variantId: item, quantityBase: 2 }],
      paymentMethod: "wallet",
    });
    // +20.00: paid now in cash on a 50.00 credit sale.
    const credit = await checkout({
      lines: [{ variantId: item, quantityBase: 4 }],
      paymentMethod: "debt",
      newCustomer: { name: `زبون الدرج ${f.runId}` },
      paidNowPiasters: 2000,
      paidFrom: "cash",
    });
    const customerId = (credit as unknown as { customerId: string }).customerId;
    // +5.25: collected later in cash.
    expect(
      (
        await call(
          transactionsRoute as Handler,
          A,
          `/api/people/${customerId}/transactions`,
          {
            type: "payment",
            amountPiasters: 525,
            paidFrom: "cash",
            opId: crypto.randomUUID(),
          },
          customerId,
        )
      ).status,
    ).toBe(201);
    // Not the drawer: a collection into the machine.
    await call(
      transactionsRoute as Handler,
      A,
      `/api/people/${customerId}/transactions`,
      {
        type: "payment",
        amountPiasters: 300,
        paidFromMachineId: machineId,
        opId: crypto.randomUUID(),
      },
      customerId,
    );
    // −7.75: a cash expense; a wallet expense does not count; a cash expense cancelled the
    // same period counts nowhere.
    await expenses.createExpense(A.storeId, A.userId, {
      category: "نقل",
      amountPiasters: 775,
      paidFrom: "cash",
    });
    await expenses.createExpense(A.storeId, A.userId, {
      category: "نقل",
      amountPiasters: 999,
      paidFrom: "wallet",
      paidFromMachineId: machineId,
    });
    const cancelled = await expenses.createExpense(A.storeId, A.userId, {
      category: "صيانة",
      amountPiasters: 4321,
      paidFrom: "cash",
    });
    await expenses.deleteExpense(A.storeId, A.userId, cancelled.id);
    // −30.10: stock paid in cash.
    expect(
      (
        await call(stockRoute as Handler, A, "/api/stock", {
          action: "add",
          storeVariantId: item,
          quantityBase: 3,
          costTotalPiasters: 3010,
          paidFrom: "cash",
          opId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    // −40.00: paid now in cash on a 100.00 supplier invoice (its batch is not counted again).
    expect(
      (
        await call(purchases.POST as Handler, A, "/api/purchases", {
          opId: crypto.randomUUID(),
          supplierId,
          lines: [
            {
              storeVariantId: item,
              quantityBase: 10,
              totalCostPiasters: 10000,
            },
          ],
          paidNowPiasters: 4000,
          paidFrom: "cash",
        })
      ).status,
    ).toBe(201);
    // −10.00: a later cash payment to the supplier.
    await call(
      transactionsRoute as Handler,
      A,
      `/api/people/${supplierId}/transactions`,
      {
        type: "payment",
        amountPiasters: 1000,
        paidFrom: "cash",
        opId: crypto.randomUUID(),
      },
      supplierId,
    );
    // −15.00: the machine topped up from the drawer.
    await machines.topupMachine(A.storeId, A.userId, machineId, 1500, {
      source: DRAWER_TOPUP_SOURCE,
    });
    // −12.50: one piece of the cash sale returned (a partial return).
    const ret = await call(
      returnRoute as Handler,
      A,
      `/api/sales/${cashSale.id}/returns`,
      {
        opId: crypto.randomUUID(),
        lines: [{ saleLineId: cashSale.lines[0]!.id, quantityBase: 1 }],
      },
      cashSale.id,
    );
    expect(ret.status).toBe(201);

    const IN = 3750 + 2000 + 525;
    const OUT = 775 + 3010 + 4000 + 1000 + 1500 + 1250;
    const r = await call(
      drawerGet as Handler,
      A,
      "/api/drawer",
      undefined,
      "",
      "GET",
    );
    expect(r.status).toBe(200);
    const d = r.json.drawer as Awaited<ReturnType<typeof getDrawer>>;
    expect(d.inPiasters).toBe(IN);
    expect(d.outPiasters).toBe(OUT);
    expect(d.expectedPiasters).toBe(100000 + IN - OUT);
    expect(d.expectedPiasters).toBe(94740);
    const byKey = Object.fromEntries(
      d.flows.map((x) => [x.key, x.amountPiasters]),
    );
    expect(byKey).toMatchObject({
      cashSales: 3750,
      collections: 2525,
      expenses: 775,
      stockPurchases: 3010,
      supplierPayments: 5000,
      machineTopups: 1500,
      refunds: 1250,
      expenseCancels: 0,
      voids: 0,
    });
    // The movement list adds up to the same totals, one line per movement.
    const sum = (dir: "in" | "out") =>
      d.movements
        .filter((m) => m.direction === dir)
        .reduce((s, m) => s + m.amountPiasters, 0);
    expect(sum("in")).toBe(IN);
    expect(sum("out")).toBe(OUT);
    expect(d.movements).toHaveLength(9);
    expect(d.movements.find((m) => m.kind === "cashSales")?.title).toContain(
      "صنف الدرج",
    );
    expect(d.unknown.count).toBe(0);
  });

  it("closing records the server's difference once", async () => {
    const opId = crypto.randomUUID();
    const close = (counted: number, id = opId) =>
      call(drawerPost as Handler, A, "/api/drawer", {
        opId: id,
        countedPiasters: counted,
      });
    const first = await close(94700);
    expect(first.status).toBe(201);
    const d = first.json.drawer as Awaited<ReturnType<typeof getDrawer>>;
    expect(d.lastCount?.countedPiasters).toBe(94700);
    expect(d.lastCount?.expectedPiasters).toBe(94740);
    expect(d.lastCount?.differencePiasters).toBe(-40);
    // After the close the drawer starts from the counted amount.
    expect(d.expectedPiasters).toBe(94700);
    expect(d.inPiasters).toBe(0);
    expect(d.movements).toHaveLength(0);

    // A double submit (same opId) is the same close.
    const again = await close(94700);
    expect(again.status).toBe(201);
    const counts = await f.as(A, (tx) =>
      tx.cashDrawerCount.count({ where: { storeId: A.storeId } }),
    );
    expect(counts).toBe(2);
    // The same close from another tab (new opId, same amount, nothing moved): refused.
    const dup = await close(94700, crypto.randomUUID());
    expect(dup.status).toBe(409);
    // Invalid amounts: 400, nothing recorded.
    for (const bad of [-1, 1.5]) {
      expect((await close(bad, crypto.randomUUID())).status).toBe(400);
    }
    expect(
      await f.as(A, (tx) =>
        tx.cashDrawerCount.count({ where: { storeId: A.storeId } }),
      ),
    ).toBe(2);
  });

  it("two closes at once are recorded one after the other", async () => {
    const [a, b] = await Promise.all([
      recordDrawerCount(A.storeId, A.userId, {
        opId: crypto.randomUUID(),
        countedPiasters: 94800,
      }),
      recordDrawerCount(A.storeId, A.userId, {
        opId: crypto.randomUUID(),
        countedPiasters: 94900,
      }),
    ]);
    const all = await f.as(A, (tx) =>
      tx.cashDrawerCount.findMany({
        where: { storeId: A.storeId },
        orderBy: { countedAt: "asc" },
      }),
    );
    const [x, y] = all.slice(-2);
    // The second close's expected amount is the first close's count (serialized).
    expect(Number(y!.expectedPiasters)).toBe(Number(x!.countedPiasters));
    expect(
      [a.lastCount?.countedPiasters, b.lastCount?.countedPiasters].sort(),
    ).toEqual([94800, 94900]);
  });

  it("a credit invoice's refund beyond what is owed is reported, never guessed", async () => {
    await recordDrawerCount(A.storeId, A.userId, {
      opId: crypto.randomUUID(),
      countedPiasters: 50000,
    });
    const inv = await checkout({
      lines: [{ variantId: item, quantityBase: 2 }],
      paymentMethod: "debt",
      newCustomer: { name: `زبون مرتجع ${f.runId}` },
      paidNowPiasters: 2500,
      paidFrom: "cash",
    });
    await call(
      returnRoute as Handler,
      A,
      `/api/sales/${inv.id}/returns`,
      {
        opId: crypto.randomUUID(),
        lines: [{ saleLineId: inv.lines[0]!.id, quantityBase: 2 }],
      },
      inv.id,
    );
    const d = await getDrawer(A.storeId, A.userId);
    expect(d.inPiasters).toBe(2500);
    expect(d.unknown.count).toBe(1);
    expect(d.unknown.amountPiasters).toBe(2500);
  });
});
