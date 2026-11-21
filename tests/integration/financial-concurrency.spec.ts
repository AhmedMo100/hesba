/**
 * Money and stock under concurrent requests (production readiness audit), real Postgres and the
 * app's route handlers — the cases not covered elsewhere:
 * - two partial returns at once on the same sale line can never give back more than was sold,
 *   and the stock grows exactly by what was really returned;
 * - the same return sent 3 times at once (one opId) is ONE return;
 * - two supplier payments at once can never pay a purchase more than it owes;
 * - the same supplier payment sent 3 times at once (one opId) is ONE payment.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import * as purchases from "@/app/api/purchases/route";
import { POST as payPurchaseRoute } from "@/app/api/purchases/[id]/payments/route";
import * as people from "@/app/api/people/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
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

type Invoice = {
  id: string;
  lines: Array<{ id: string; variantId: string; returnedQuantityBase: number }>;
};
type PurchaseJson = {
  id: string;
  paidPiasters: number;
  outstandingPiasters: number;
};

const level = async (variantId: string) =>
  (await f.stockState(A, variantId)).level;

describe("money and stock under concurrent requests", () => {
  let variantId = "";

  beforeAll(async () => {
    await f.setup();
    variantId = (await f.product(A, { name: "صنف تزامن", sell: 1000 }))
      .variantId;
    await f.addStock(A, variantId, 200);
  });

  afterAll(async () => {
    await f.teardown();
  });

  const sell = async (qty: number) => {
    const r = await call(checkoutRoute as Handler, A, "/api/sales/checkout", {
      opId: crypto.randomUUID(),
      lines: [{ variantId, quantityBase: qty }],
      discountPiasters: 0,
      paymentMethod: "cash",
      paidNowPiasters: 0,
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    return r.json.invoice as Invoice;
  };
  const giveBack = (inv: Invoice, qty: number, opId = crypto.randomUUID()) =>
    call(
      returnRoute as Handler,
      A,
      `/api/sales/${inv.id}/returns`,
      { opId, lines: [{ saleLineId: inv.lines[0]!.id, quantityBase: qty }] },
      inv.id,
    );
  /** What was really given back on the invoice's (single) line, from the ledger itself. */
  const returnedOf = async (inv: Invoice) =>
    (
      await f.as(A, (tx) =>
        tx.saleReturnLine.aggregate({
          where: { storeId: A.storeId, saleLineId: inv.lines[0]!.id },
          _sum: { quantityBase: true },
        }),
      )
    )._sum.quantityBase ?? 0;

  it("two returns of 3 at once on a line of 5: one is refused, never 6 back", async () => {
    const inv = await sell(5);
    const before = await level(variantId);
    const [x, y] = await Promise.all([giveBack(inv, 3), giveBack(inv, 3)]);
    expect([x.status, y.status].sort()).toEqual([201, 400]);
    expect(Number(await returnedOf(inv))).toBe(3);
    expect(await level(variantId)).toBe(before + 3);
  });

  it("five returns of 1 at once on a line of 3: exactly 3 succeed", async () => {
    const inv = await sell(3);
    const before = await level(variantId);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => giveBack(inv, 1)),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3);
    expect(rs.filter((r) => r.status === 400)).toHaveLength(2);
    expect(Number(await returnedOf(inv))).toBe(3);
    expect(await level(variantId)).toBe(before + 3);
  });

  it("the same return sent 3 times at once (one opId) is one return", async () => {
    const inv = await sell(4);
    const before = await level(variantId);
    const opId = crypto.randomUUID();
    const rs = await Promise.all([
      giveBack(inv, 2, opId),
      giveBack(inv, 2, opId),
      giveBack(inv, 2, opId),
    ]);
    expect(rs.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(Number(await returnedOf(inv))).toBe(2);
    expect(await level(variantId)).toBe(before + 2);
  });

  describe("supplier payments", () => {
    let supplierId = "";
    const buy = async (totalCost: number) => {
      const r = await call(purchases.POST as Handler, A, "/api/purchases", {
        opId: crypto.randomUUID(),
        supplierId,
        lines: [
          {
            storeVariantId: variantId,
            quantityBase: 2,
            totalCostPiasters: totalCost,
          },
        ],
      });
      expect(r.status, JSON.stringify(r.json)).toBe(201);
      return r.json.purchase as PurchaseJson;
    };
    const pay = (id: string, amount: number, opId = crypto.randomUUID()) =>
      call(
        payPurchaseRoute as Handler,
        A,
        `/api/purchases/${id}/payments`,
        { opId, amountPiasters: amount },
        id,
      );
    const supplierBalance = async () =>
      (
        (
          await call(
            personRoute as Handler,
            A,
            `/api/people/${supplierId}`,
            undefined,
            supplierId,
            "GET",
          )
        ).json.person as { amount_piasters: number }
      ).amount_piasters;

    beforeAll(async () => {
      const r = await call(people.POST as Handler, A, "/api/people", {
        name: `مورد تزامن ${f.runId}`,
        section: "suppliers",
        amountEgp: "0",
      });
      expect(r.status).toBe(201);
      supplierId = (r.json.person as { id: string }).id;
    });

    it("two payments of 600 at once on a 1,000 purchase: one is refused, nothing overpaid", async () => {
      const p = await buy(100000);
      const [x, y] = await Promise.all([pay(p.id, 60000), pay(p.id, 60000)]);
      expect([x.status, y.status].sort()).toEqual([201, 400]);
      const ok = (x.status === 201 ? x : y).json.purchase as PurchaseJson;
      expect(ok.paidPiasters).toBe(60000);
      expect(ok.outstandingPiasters).toBe(40000);
      expect(await supplierBalance()).toBe(40000);
    });

    it("the same payment sent 3 times at once (one opId) is paid once", async () => {
      const before = await supplierBalance();
      const p = await buy(50000);
      const opId = crypto.randomUUID();
      const rs = await Promise.all([
        pay(p.id, 20000, opId),
        pay(p.id, 20000, opId),
        pay(p.id, 20000, opId),
      ]);
      expect(rs.every((r) => r.status === 201 || r.status === 200)).toBe(true);
      const outstanding = rs.map(
        (r) => (r.json.purchase as PurchaseJson).outstandingPiasters,
      );
      expect(new Set(outstanding)).toEqual(new Set([30000]));
      expect(await supplierBalance()).toBe(before + 30000);
    });
  });
});
