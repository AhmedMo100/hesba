/**
 * ADR-0036 (real Postgres, the app role, the real routes and services):
 * - two packages again: each package reads its own report periods only — months for إدارة
 *   المحل, days for الكاشير الذكي — refused (403) otherwise, on the screen route and the file;
 * - a manual debt with products: the server sums the lines, refuses a mismatched amount, another
 *   shop's product, and products on a payment; one entry, no stock, no money, no revenue;
 * - the account statement: a credit invoice is ONE debt with its products, its payment settles
 *   it, a manual debt shows its products, another shop's person is a 404, no session is a 401;
 * - a supplier's credit purchase is ONE due with its products;
 * - a service commission as a fixed amount or a percentage (no tiers) is saved and charged,
 *   and editing it never changes a past operation;
 * - the stocktake: «منتهي الصلاحية» is a loss recorded once as expired, with the owner's note.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { GET as reportHome } from "@/app/api/reports/home/route";
import { GET as reportExport } from "@/app/api/reports/export/route";
import { GET as statementRoute } from "@/app/api/people/[id]/statement/route";
import { POST as transactionsRoute } from "@/app/api/people/[id]/transactions/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as configRoute } from "@/app/api/sales/config/route";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { saveSalesViewConfig } from "@/server/modules/sales";
import { recordServiceTransaction } from "@/server/modules/services";
import {
  confirmInventoryCount,
  startInventoryCount,
  updateInventoryCount,
} from "@/server/modules/inventory";
import { reportPeriodRefusal, monthQuery } from "@/domain/report-periods";
import { toCairoDateString, addDaysToDateKey } from "@/domain/time";
import { SaleFixtures, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA; // الكاشير الذكي (the fixtures' default)
const B = f.shopB; // switched to إدارة المحل below
const tokens = new Map<string, string>();
const op = () => crypto.randomUUID();
const machines = new MachinesService(appPrisma);
const today = toCairoDateString(new Date());

async function cookieOf(shop: Shop | null) {
  if (!shop) return "";
  let token = tokens.get(shop.storeId);
  if (!token) {
    token = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, token);
  }
  return `hesba_session=${token}`;
}

async function get(
  handler: (req: Request) => Promise<Response>,
  shop: Shop | null,
  path: string,
) {
  return handler(
    new Request(`http://localhost:3000${path}`, {
      headers: { cookie: await cookieOf(shop) },
    }),
  );
}

async function personRoute(
  handler: (
    req: Request,
    ctx: { params: Promise<{ id: string }> },
  ) => Promise<Response>,
  shop: Shop | null,
  id: string,
  body?: unknown,
) {
  return handler(
    new Request(`http://localhost:3000/api/people/${id}/x`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: await cookieOf(shop),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

let customerA = "";
let customerB = "";
let supplierA = "";

beforeAll(async () => {
  await f.setup();
  // B is an إدارة المحل shop (an owner's switch, as PATCH /api/store/operating-mode does).
  await f.as(B, (tx) =>
    tx.store.update({
      where: { id: B.storeId },
      data: { operatingMode: "simple" },
    }),
  );
  customerA = (
    await f.as(A, (tx) =>
      tx.customer.create({
        data: { storeId: A.storeId, nameAr: `زبون حساب ${f.runId}` },
      }),
    )
  ).id;
  customerB = (
    await f.as(B, (tx) =>
      tx.customer.create({
        data: { storeId: B.storeId, nameAr: `زبون محل تاني ${f.runId}` },
      }),
    )
  ).id;
  supplierA = (
    await f.as(A, (tx) =>
      tx.supplier.create({
        data: { storeId: A.storeId, nameAr: `مورد حساب ${f.runId}` },
      }),
    )
  ).id;
}, 120_000);

afterAll(async () => {
  const ids = [A.storeId, B.storeId];
  const sql = f.sql;
  await sql`DELETE FROM service_transactions WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM inventory_counts WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM debt_entry_items WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM debt_entries WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM customers WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM pos_machine_topups WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM pos_machines WHERE store_id IN ${sql(ids)}`;
  await f.teardown();
});

describe("report periods by package (pure rule)", () => {
  it("days for الكاشير الذكي, whole months for إدارة المحل", () => {
    const t = "2026-11-24";
    expect(
      reportPeriodRefusal("pos", "today", undefined, undefined, t),
    ).toBeNull();
    expect(
      reportPeriodRefusal("pos", "yesterday", undefined, undefined, t),
    ).toBeNull();
    expect(
      reportPeriodRefusal("pos", "custom", "2026-11-02", "2026-11-02", t),
    ).toBeNull();
    expect(
      reportPeriodRefusal("pos", "custom", "2026-11-02", "2026-11-03", t),
    ).toMatch(/يومية/);
    expect(
      reportPeriodRefusal("pos", "month", undefined, undefined, t),
    ).toMatch(/يومية/);
    expect(
      reportPeriodRefusal("pos", "custom", "2026-11-25", "2026-11-25", t),
    ).toMatch(/مجاش/);
    expect(
      reportPeriodRefusal("simple", "custom", "2026-11-01", "2026-11-24", t),
    ).toBeNull();
    // A screen opened just before midnight is not refused just after it.
    expect(
      reportPeriodRefusal("simple", "custom", "2026-11-01", "2026-11-23", t),
    ).toBeNull();
    expect(
      reportPeriodRefusal("simple", "custom", "2026-10-01", "2026-10-31", t),
    ).toBeNull();
    expect(
      reportPeriodRefusal("simple", "custom", "2026-10-01", "2026-10-30", t),
    ).toMatch(/شهرية/);
    expect(
      reportPeriodRefusal("simple", "custom", "2026-10-02", "2026-10-31", t),
    ).toMatch(/شهرية/);
    expect(
      reportPeriodRefusal("simple", "custom", "2026-10-15", "2026-11-14", t),
    ).toMatch(/شهرية/);
    expect(
      reportPeriodRefusal("simple", "today", undefined, undefined, t),
    ).toMatch(/شهرية/);
    expect(
      reportPeriodRefusal("simple", "month", undefined, undefined, t),
    ).toMatch(/شهرية/);
    expect(
      reportPeriodRefusal("simple", "custom", "2026-12-01", "2026-12-31", t),
    ).toMatch(/مجاش/);
    expect(monthQuery("2026-02", "2026-11-24")).toEqual({
      period: "custom",
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });
});

describe("report periods by package (routes)", () => {
  it("الكاشير الذكي: days only, on the screen and the file", async () => {
    expect(
      (await get(reportHome, A, "/api/reports/home?period=today")).status,
    ).toBe(200);
    expect(
      (await get(reportHome, A, "/api/reports/home?period=yesterday")).status,
    ).toBe(200);
    expect(
      (
        await get(
          reportHome,
          A,
          `/api/reports/home?period=custom&from=${today}&to=${today}`,
        )
      ).status,
    ).toBe(200);
    const month = await get(reportHome, A, "/api/reports/home?period=month");
    expect(month.status).toBe(403);
    expect((await month.json()).error.message).toMatch(/يومية/);
    const q = monthQuery(today.slice(0, 7), today);
    expect(
      (
        await get(
          reportHome,
          A,
          `/api/reports/home?period=custom&from=${q.from}&to=${q.to}`,
        )
      ).status,
    ).toBe(q.from === q.to ? 200 : 403);
    expect(
      (await get(reportExport, A, "/api/reports/export?period=week")).status,
    ).toBe(403);
    expect(
      (
        await get(
          reportExport,
          A,
          "/api/reports/export?period=today&format=csv",
        )
      ).status,
    ).toBe(200);
    // No session: 401 before anything else.
    expect(
      (await get(reportHome, null, "/api/reports/home?period=month")).status,
    ).toBe(401);
  });

  it("إدارة المحل: whole months only", async () => {
    const q = monthQuery(today.slice(0, 7), today);
    const ok = await get(
      reportHome,
      B,
      `/api/reports/home?period=custom&from=${q.from}&to=${q.to}`,
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.period).toBe("custom");
    expect(body.from).toBeTruthy();
    expect(
      (await get(reportHome, B, "/api/reports/home?period=today")).status,
    ).toBe(403);
    expect(
      (await get(reportHome, B, "/api/reports/home?period=month")).status,
    ).toBe(403);
    const yesterday = addDaysToDateKey(today, -1);
    expect(
      (
        await get(
          reportHome,
          B,
          `/api/reports/home?period=custom&from=${yesterday}&to=${yesterday}`,
        )
      ).status,
    ).toBe(q.from === yesterday ? 200 : 403);
    expect(
      (
        await get(
          reportExport,
          B,
          `/api/reports/export?period=custom&from=${q.from}&to=${q.to}&format=csv`,
        )
      ).status,
    ).toBe(200);
    expect(
      (await get(reportExport, B, "/api/reports/export?period=today")).status,
    ).toBe(403);
  });
});

describe("customer and supplier accounts", () => {
  it("a manual debt with products: summed on the server, one entry, no stock, no money", async () => {
    const { variantId } = await f.product(A, {
      name: "شاي يدوي",
      sell: 2500,
      buy: 2000,
    });
    await f.addStock(A, variantId, 20, { cost: 40000 });
    const before = (await f.stockState(A, variantId)).level;

    const opId = op();
    const body = {
      type: "debt",
      opId,
      date: today,
      note: "أخدهم الصبح",
      items: [
        { variantId, quantityBase: 3, unitPricePiasters: 2400 },
        { name: "كيس عيش", quantityBase: 2, unitPricePiasters: 500 },
      ],
    };
    const res = await personRoute(transactionsRoute, A, customerA, body);
    expect(res.status).toBe(201);
    const tx = (await res.json()).transaction;
    // 3 × 24.00 + 2 × 5.00 = 82.00
    expect(tx.amount_piasters).toBe(8200);
    expect(tx.type).toBe("debt");
    // The same tap again: the same entry, nothing new.
    expect(
      (await personRoute(transactionsRoute, A, customerA, body)).status,
    ).toBe(201);
    const entries = await f.as(A, (t) =>
      t.debtEntry.findMany({
        where: { storeId: A.storeId, customerId: customerA },
      }),
    );
    expect(entries).toHaveLength(1);
    const items = await f.as(A, (t) =>
      t.debtEntryItem.findMany({
        where: { storeId: A.storeId, debtEntryId: entries[0]!.id },
      }),
    );
    expect(items).toHaveLength(2);
    expect(
      items.map((i) => Number(i.totalMinor)).sort((a, b) => a - b),
    ).toEqual([1000, 7200]);
    // Written on the account only: the stock did not move, no sale was made.
    expect((await f.stockState(A, variantId)).level).toBe(before);
    const sales = await f.as(A, (t) =>
      t.sale.count({ where: { storeId: A.storeId, customerId: customerA } }),
    );
    expect(sales).toBe(0);

    // A typed amount must equal the lines; products only on a debt; only this shop's products.
    expect(
      (
        await personRoute(transactionsRoute, A, customerA, {
          ...body,
          opId: op(),
          amountPiasters: 9999,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await personRoute(transactionsRoute, A, customerA, {
          type: "payment",
          opId: op(),
          amountPiasters: 100,
          items: body.items,
        })
      ).status,
    ).toBe(400);
    const { variantId: theirs } = await f.product(B, {
      name: "منتج محل تاني",
      sell: 1000,
    });
    expect(
      (
        await personRoute(transactionsRoute, A, customerA, {
          type: "debt",
          opId: op(),
          items: [
            { variantId: theirs, quantityBase: 1, unitPricePiasters: 1000 },
          ],
        })
      ).status,
    ).toBe(404);
    // Another shop's customer: 404, no session: 401.
    expect(
      (
        await personRoute(transactionsRoute, A, customerB, {
          type: "debt",
          opId: op(),
          amountPiasters: 100,
        })
      ).status,
    ).toBe(404);
  });

  it("the statement: a credit invoice is ONE debt with its products; its payment settles it", async () => {
    const { variantId } = await f.product(A, {
      name: "رز الكشف",
      sell: 3000,
      buy: 2000,
    });
    await f.addStock(A, variantId, 10, { cost: 20000 });
    const res = await checkoutRoute(
      new Request("http://localhost:3000/api/sales/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: await cookieOf(A),
        },
        body: JSON.stringify({
          opId: op(),
          lines: [{ variantId, quantityBase: 2 }],
          discountPiasters: 0,
          paymentMethod: "debt",
          customerId: customerA,
          paidNowPiasters: 1000,
        }),
      }),
    );
    expect(res.status).toBe(201);
    // A collection: settles the debt, not a new sale.
    expect(
      (
        await personRoute(transactionsRoute, A, customerA, {
          type: "payment",
          opId: op(),
          amountPiasters: 2000,
          paidFrom: "cash",
        })
      ).status,
    ).toBe(201);
    const st = await personRoute(statementRoute, A, customerA);
    expect(st.status).toBe(200);
    const s = await st.json();
    const sale = s.entries.filter(
      (e: { source: string }) => e.source === "sale",
    );
    expect(sale).toHaveLength(1);
    expect(sale[0].amount_piasters).toBe(6000);
    expect(sale[0].lines).toEqual([
      expect.objectContaining({
        quantityBase: 2,
        unitPricePiasters: 3000,
        totalPiasters: 6000,
      }),
    ]);
    expect(sale[0].saleId).toBeTruthy();
    const manual = s.entries.filter(
      (e: { source: string }) => e.source === "manual",
    );
    expect(manual).toHaveLength(1);
    expect(manual[0].lines).toHaveLength(2);
    expect(manual[0].note).toBe("أخدهم الصبح");
    const payments = s.entries.filter(
      (e: { source: string }) => e.source === "payment",
    );
    expect(payments.length).toBe(2); // the 10.00 paid at the sale + the 20.00 collection
    // 82.00 manual + 60.00 invoice − 10.00 − 20.00
    expect(s.balancePiasters).toBe(11200);
    const salesCount = await f.as(A, (t) =>
      t.sale.count({ where: { storeId: A.storeId, customerId: customerA } }),
    );
    expect(salesCount).toBe(1);

    // Another shop's person: 404; no session: 401; a bad id: 400.
    expect((await personRoute(statementRoute, A, customerB)).status).toBe(404);
    expect((await personRoute(statementRoute, null, customerA)).status).toBe(
      401,
    );
    expect((await personRoute(statementRoute, A, "not-a-uuid")).status).toBe(
      400,
    );
  });

  it("a supplier's credit purchase is one due with its products", async () => {
    const { variantId } = await f.product(A, {
      name: "سكر المورد",
      sell: 3000,
      buy: 2500,
    });
    const { createPurchase } = await import("@/server/modules/purchases");
    await createPurchase(A.storeId, A.userId, {
      opId: op(),
      supplierId: supplierA,
      lines: [
        {
          storeVariantId: variantId,
          quantityBase: 4,
          totalCostPiasters: 10000,
        },
      ],
      paidNowPiasters: 4000,
      paidFrom: "cash",
    } as never);
    const s = await (await personRoute(statementRoute, A, supplierA)).json();
    const due = s.entries.filter(
      (e: { source: string }) => e.source === "purchase",
    );
    expect(due).toHaveLength(1);
    expect(due[0].amount_piasters).toBe(10000);
    expect(due[0].lines[0]).toEqual(
      expect.objectContaining({
        quantityBase: 4,
        unitPricePiasters: 2500,
        totalPiasters: 10000,
      }),
    );
    expect(s.balancePiasters).toBe(6000);
    // A manual due with products for the supplier, on «عليك».
    const r = await personRoute(transactionsRoute, A, supplierA, {
      type: "debt",
      opId: op(),
      items: [{ name: "كراتين", quantityBase: 5, unitPricePiasters: 300 }],
    });
    expect(r.status).toBe(201);
    const after = await (
      await personRoute(statementRoute, A, supplierA)
    ).json();
    expect(after.balancePiasters).toBe(7500);
  });
});

describe("service commission: fixed or percentage", () => {
  it("saves one value for every operation and charges it; history keeps its commission", async () => {
    const { productId } = await f.product(A, {
      name: "شحن رصيد ثابت",
      sell: 500,
      category: "شحن رصيد",
    });
    const wallet = (
      await machines.upsertMachine(A.storeId, A.userId, {
        name: `محفظة ${f.runId}`,
        provider: "محفظة",
      })
    ).id;
    await machines.topupMachine(A.storeId, A.userId, wallet, 100000);
    await saveSalesViewConfig(A.storeId, A.userId, {
      serviceCommissions: {
        [productId]: { type: "fixed", value: 500, tiers: [] },
      },
    });
    const first = await recordServiceTransaction(A.storeId, A.userId, {
      opId: op(),
      serviceProductId: productId,
      direction: "send",
      amountPiasters: 10000,
      floatMachineId: wallet,
      payment: "cash",
    });
    expect(first.commissionPiasters).toBe(500);
    await saveSalesViewConfig(A.storeId, A.userId, {
      serviceCommissions: {
        [productId]: { type: "percent", value: 2, tiers: [] },
      },
    });
    const second = await recordServiceTransaction(A.storeId, A.userId, {
      opId: op(),
      serviceProductId: productId,
      direction: "send",
      amountPiasters: 10000,
      floatMachineId: wallet,
      payment: "cash",
    });
    expect(second.commissionPiasters).toBe(200);
    const kept = await f.as(A, (t) =>
      t.serviceTransaction.findUniqueOrThrow({ where: { id: first.id } }),
    );
    expect(Number(kept.commissionPiasters)).toBe(500);
    // Through the route: a fixed / percentage rule (no tiers) is accepted, above 100% is a 400.
    const post = async (rule: unknown) =>
      configRoute(
        new Request("http://localhost:3000/api/sales/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: await cookieOf(A),
          },
          body: JSON.stringify({ serviceCommissions: { [productId]: rule } }),
        }),
      );
    expect((await post({ type: "percent", value: 2, tiers: [] })).status).toBe(
      200,
    );
    expect((await post({ type: "fixed", value: 500, tiers: [] })).status).toBe(
      200,
    );
    expect(
      (await post({ type: "percent", value: 150, tiers: [] })).status,
    ).toBe(400);
    expect((await post({ type: "fixed", value: -1, tiers: [] })).status).toBe(
      400,
    );
  });
});

describe("stocktake: expired with a note", () => {
  it("is a loss recorded once as expired, with the owner's note", async () => {
    const { variantId } = await f.product(A, {
      name: "زبادي الجرد",
      sell: 1000,
      buy: 700,
    });
    await f.addStock(A, variantId, 10, { cost: 7000 });
    const c = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: [variantId],
    });
    const u = await updateInventoryCount(A.storeId, A.userId, c.id, {
      lines: [
        {
          variantId,
          countedBase: 7,
          reason: "expired",
          note: "تاريخه خلص امبارح",
        },
      ],
    });
    expect(u.lines[0]!.reason).toBe("expired");
    expect(u.lines[0]!.note).toBe("تاريخه خلص امبارح");
    expect(u.totals.expiredBase).toBe(3);
    expect(u.totals.shortageLines).toBe(1);
    const done = await confirmInventoryCount(A.storeId, A.userId, c.id, op());
    expect(done.status).toBe("confirmed");
    const waste = await f.as(A, (t) =>
      t.wasteRecord.findMany({
        where: { storeId: A.storeId, storeVariantId: variantId },
      }),
    );
    expect(waste).toHaveLength(1);
    expect(waste[0]!.reason).toBe("expired");
    expect(waste[0]!.note).toContain("تاريخه خلص امبارح");
    expect((await f.stockState(A, variantId)).level).toBe(7);
  });
});
