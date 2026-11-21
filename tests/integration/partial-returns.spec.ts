/**
 * Partial returns of one invoice in every way Hesba sells (real Postgres, route handlers): a
 * piece, a weight (5.5 kg → 1.25 kg back), a carton product, pieces sold by the carton, a jar,
 * a bag. Each return gives back only that quantity (stock and money), never more than is left,
 * once per operation, and a credit invoice's debt goes down by the returned value — without a
 * new debt or a deleted one. The report counts the sale net of its return.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import { GET as invoiceRoute } from "@/app/api/sales/[id]/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
import { GET as reportRoute } from "@/app/api/reports/home/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
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

type Line = {
  id: string;
  variantId: string;
  quantityBase: number;
  returnedQuantityBase: number;
  totalPiasters: number;
  returnedPiasters: number;
  packQty: number;
};
type Invoice = {
  id: string;
  totalPiasters: number;
  returnedPiasters: number;
  outstandingPiasters: number;
  returnCreditedPiasters: number;
  returnRefundedPiasters: number;
  customerId: string | null;
  lines: Line[];
};

const sell = async (lines: Array<[string, number]>, extra: Json = {}) => {
  const r = await call(checkoutRoute as Handler, A, "/api/sales/checkout", {
    opId: crypto.randomUUID(),
    lines: lines.map(([variantId, quantityBase]) => ({
      variantId,
      quantityBase,
    })),
    discountPiasters: 0,
    paymentMethod: "cash",
    paidNowPiasters: 0,
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.json.invoice as Invoice;
};
const giveBack = (
  inv: Invoice,
  lines: Array<[string, number]>,
  opId = crypto.randomUUID(),
) =>
  call(
    returnRoute as Handler,
    A,
    `/api/sales/${inv.id}/returns`,
    {
      opId,
      lines: lines.map(([saleLineId, quantityBase]) => ({
        saleLineId,
        quantityBase,
      })),
    },
    inv.id,
  );
const lineOf = (inv: Invoice, variantId: string) =>
  inv.lines.find((l) => l.variantId === variantId)!;
const level = async (variantId: string) =>
  (await f.stockState(A, variantId)).level;

describe("partial returns, every selling unit", () => {
  const v: Record<string, string> = {};

  beforeAll(async () => {
    await f.setup();
    v.piece = (await f.product(A, { name: "قلم", sell: 500 })).variantId;
    v.kg = (
      await f.product(A, { name: "جبنة", unit: "kg", sell: 32000 })
    ).variantId;
    v.carton = (
      await f.product(A, { name: "مياه", unit: "كرتونة", sell: 8000 })
    ).variantId;
    v.pack = (await f.product(A, { name: "كولا", sell: 1500 })).variantId;
    v.jar = (
      await f.product(A, { name: "عسل", unit: "برطمان", sell: 6000 })
    ).variantId;
    v.bag = (
      await f.product(A, { name: "سكر", unit: "bag", sell: 3800 })
    ).variantId;
    // Pieces sold by the carton of 12 too.
    await f.as(A, (tx) =>
      tx.storeVariant.update({
        where: { id: v.pack },
        data: { packQty: 12, sizeUnit: "carton" },
      }),
    );
    for (const [k, id] of Object.entries(v))
      await f.addStock(A, id, k === "kg" ? 20000 : 400);
  });

  afterAll(async () => {
    await f.teardown();
  });

  it("2 pieces sold, 1 back: 1 left, stock +1, half the money", async () => {
    const inv = await sell([[v.piece!, 2]]);
    const before = await level(v.piece!);
    const r = await giveBack(inv, [[lineOf(inv, v.piece!).id, 1]]);
    expect(r.status).toBe(201);
    const after = r.json.invoice as Invoice;
    const l = lineOf(after, v.piece!);
    expect([l.quantityBase, l.returnedQuantityBase]).toEqual([2, 1]);
    expect(l.returnedPiasters).toBe(500);
    expect(after.returnedPiasters).toBe(500);
    expect(after.returnRefundedPiasters).toBe(500);
    expect(await level(v.piece!)).toBe(before + 1);
    // The second piece back too, then nothing more.
    expect((await giveBack(after, [[l.id, 1]])).status).toBe(201);
    const over = await giveBack(after, [[l.id, 1]]);
    expect(over.status).toBe(400);
    expect(await level(v.piece!)).toBe(before + 2);
  });

  it("5.5 kg sold, 1.25 kg back: value at the kilo price, 4.25 kg left", async () => {
    const inv = await sell([[v.kg!, 5500]]);
    expect(inv.totalPiasters).toBe(176000);
    const before = await level(v.kg!);
    const r = await giveBack(inv, [[lineOf(inv, v.kg!).id, 1250]]);
    expect(r.status).toBe(201);
    const l = lineOf(r.json.invoice as Invoice, v.kg!);
    expect(l.returnedQuantityBase).toBe(1250);
    expect(l.quantityBase - l.returnedQuantityBase).toBe(4250);
    expect(l.returnedPiasters).toBe(40000); // 1.25 × 320
    expect(await level(v.kg!)).toBe(before + 1250);
  });

  it("3 cartons sold, 1 back; 2 cartons of 12 sold as pieces, 1 carton back", async () => {
    const inv = await sell([
      [v.carton!, 3],
      [v.pack!, 24],
    ]);
    const c = lineOf(inv, v.carton!);
    const p = lineOf(inv, v.pack!);
    expect(p.packQty).toBe(12);
    const r = await giveBack(inv, [
      [c.id, 1],
      [p.id, 12],
    ]);
    expect(r.status).toBe(201);
    const after = r.json.invoice as Invoice;
    expect(lineOf(after, v.carton!).returnedQuantityBase).toBe(1);
    expect(lineOf(after, v.carton!).returnedPiasters).toBe(8000);
    expect(lineOf(after, v.pack!).returnedQuantityBase).toBe(12);
    expect(lineOf(after, v.pack!).returnedPiasters).toBe(18000);
    expect(after.returnedPiasters).toBe(26000);
  });

  it("a jar and a bag: one of each back", async () => {
    const inv = await sell([
      [v.jar!, 3],
      [v.bag!, 2],
    ]);
    const r = await giveBack(inv, [
      [lineOf(inv, v.jar!).id, 1],
      [lineOf(inv, v.bag!).id, 1],
    ]);
    expect(r.status).toBe(201);
    expect((r.json.invoice as Invoice).returnedPiasters).toBe(6000 + 3800);
  });

  it("refuses more than is left, zero, negative, a fraction of a base unit, another sale's line", async () => {
    const inv = await sell([[v.jar!, 2]]);
    const id = lineOf(inv, v.jar!).id;
    for (const q of [3, 0, -1, 1.5]) {
      expect((await giveBack(inv, [[id, q]])).status).toBe(400);
    }
    const other = await sell([[v.piece!, 1]]);
    expect(
      (await giveBack(inv, [[lineOf(other, v.piece!).id, 1]])).status,
    ).toBe(400);
    const fresh = (
      await call(
        invoiceRoute as Handler,
        A,
        `/api/sales/${inv.id}`,
        undefined,
        inv.id,
        "GET",
      )
    ).json.invoice as Invoice;
    expect(fresh.returnedPiasters).toBe(0);
  });

  it("the same return retried is recorded once; the same opId for another return is a 409", async () => {
    const inv = await sell([[v.jar!, 2]]);
    const id = lineOf(inv, v.jar!).id;
    const before = await level(v.jar!);
    const opId = crypto.randomUUID();
    expect((await giveBack(inv, [[id, 1]], opId)).status).toBe(201);
    const again = await giveBack(inv, [[id, 1]], opId);
    expect(again.status).toBe(200);
    expect(
      lineOf(again.json.invoice as Invoice, v.jar!).returnedQuantityBase,
    ).toBe(1);
    expect(await level(v.jar!)).toBe(before + 1);
    expect((await giveBack(inv, [[id, 2]], opId)).status).toBe(409);
  });

  it("credit: a 500 invoice, 100 back → 400 owed; with 200 paid first → 200 owed", async () => {
    const inv = await sell([[v.piece!, 100]], {
      paymentMethod: "debt",
      newCustomer: { name: `زبون مرتجع ${f.runId}` },
    });
    expect(inv.totalPiasters).toBe(50000);
    const r = await giveBack(inv, [[lineOf(inv, v.piece!).id, 20]]);
    const after = r.json.invoice as Invoice;
    expect(after.outstandingPiasters).toBe(40000);
    expect(after.returnCreditedPiasters).toBe(10000);
    expect(after.returnRefundedPiasters).toBe(0);
    const person = (
      await call(
        personRoute as Handler,
        A,
        `/api/people/${inv.customerId}`,
        undefined,
        inv.customerId!,
        "GET",
      )
    ).json.person as { amount_piasters: number };
    expect(person.amount_piasters).toBe(40000);
    // The invoice's debt is still one entry; the return is a reversal next to it.
    const entries = await f.as(A, (tx) =>
      tx.debtEntry.findMany({
        where: { saleId: inv.id },
        select: { entryKind: true, direction: true },
      }),
    );
    expect(
      entries.filter(
        (e) => e.entryKind === "transaction" && e.direction === "owed_to_me",
      ),
    ).toHaveLength(1);
    expect(entries.filter((e) => e.entryKind === "reversal")).toHaveLength(1);

    const paid = await sell([[v.piece!, 100]], {
      paymentMethod: "debt",
      newCustomer: { name: `زبون دفع ${f.runId}` },
      paidNowPiasters: 20000,
      paidFrom: "cash",
    });
    const r2 = await giveBack(paid, [[lineOf(paid, v.piece!).id, 20]]);
    expect((r2.json.invoice as Invoice).outstandingPiasters).toBe(20000);
    // Returning more than is still owed pays the rest back.
    const r3 = await giveBack(r2.json.invoice as Invoice, [
      [lineOf(paid, v.piece!).id, 60],
    ]);
    const end = r3.json.invoice as Invoice;
    expect(end.outstandingPiasters).toBe(0);
    expect(end.returnCreditedPiasters).toBe(30000);
    expect(end.returnRefundedPiasters).toBe(10000);
  });

  it("the report counts sales net of their returns", async () => {
    const r = await call(
      reportRoute as Handler,
      A,
      "/api/reports/home?period=today",
      undefined,
      "",
      "GET",
    );
    expect(r.status).toBe(200);
    const sales = (r.json as { sales: { revenuePiasters: number } }).sales;
    const all = await f.as(A, (tx) =>
      tx.sale.findMany({
        where: { storeId: A.storeId, saleVoid: { is: null } },
        select: {
          totalPiasters: true,
          saleReturns: { select: { amountPiasters: true } },
        },
      }),
    );
    const net = all.reduce(
      (s, x) =>
        s +
        Number(x.totalPiasters) -
        x.saleReturns.reduce((n, y) => n + Number(y.amountPiasters), 0),
      0,
    );
    expect(sales.revenuePiasters).toBe(net);
  });
});
