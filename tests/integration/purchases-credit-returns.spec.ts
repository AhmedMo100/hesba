/**
 * QA-30 (supplier purchases) and QA-31 (cart checkout, discounts, payment methods, credit
 * sales, returns) — ADR-0027. Real route handlers, real sessions, real Postgres with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { withTenant } from "@/server/infra/db/tenant";
import { POST as peopleRoute } from "@/app/api/people/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
import * as purchases from "@/app/api/purchases/route";
import { GET as getPurchaseRoute } from "@/app/api/purchases/[id]/route";
import { POST as payPurchaseRoute } from "@/app/api/purchases/[id]/payments/route";
import { POST as voidPurchaseRoute } from "@/app/api/purchases/[id]/void/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { GET as invoiceRoute } from "@/app/api/sales/[id]/route";
import { POST as paySaleRoute } from "@/app/api/sales/[id]/payments/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const tokens = new Map<string, string>();
type Handler = (req: Request, ctx: never) => Promise<Response>;

async function call(
  handler: Handler,
  shop: Shop,
  method: string,
  path: string,
  body?: unknown,
  id = "",
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

const person = async (
  shop: Shop,
  section: "owedToMe" | "suppliers",
  name: string,
) => {
  const r = await call(peopleRoute as Handler, shop, "POST", "/api/people", {
    name: `${name} ${f.runId}`,
    section,
    amountEgp: "0",
  });
  expect(r.status).toBe(201);
  return (r.json.person as { id: string }).id;
};
const balanceOf = async (shop: Shop, id: string) =>
  (
    (
      await call(
        personRoute as Handler,
        shop,
        "GET",
        `/api/people/${id}`,
        undefined,
        id,
      )
    ).json.person as { amount_piasters: number }
  ).amount_piasters;

type PurchaseJson = {
  id: string;
  totalPiasters: number;
  paidPiasters: number;
  outstandingPiasters: number;
  voided: boolean;
  duplicate?: boolean;
  lines: Array<{
    batchId: string;
    quantityBase: number;
    totalCostPiasters: number;
  }>;
};
const buy = (shop: Shop, body: Json) =>
  call(purchases.POST as Handler, shop, "POST", "/api/purchases", body);
const payP = (shop: Shop, id: string, body: Json) =>
  call(
    payPurchaseRoute as Handler,
    shop,
    "POST",
    `/api/purchases/${id}/payments`,
    body,
    id,
  );
const voidP = (shop: Shop, id: string, body: Json) =>
  call(
    voidPurchaseRoute as Handler,
    shop,
    "POST",
    `/api/purchases/${id}/void`,
    body,
    id,
  );
const pOf = (r: { json: Json }) => r.json.purchase as PurchaseJson;

type InvoiceJson = {
  id: string;
  paymentMethod: string;
  subtotalPiasters: number;
  discountPiasters: number;
  totalPiasters: number;
  returnedPiasters: number;
  outstandingPiasters: number;
  duplicate?: boolean;
  lines: Array<{
    id: string;
    variantId: string;
    quantityBase: number;
    unitPricePiasters: number;
    discountPiasters: number;
    totalPiasters: number;
    returnedQuantityBase: number;
  }>;
};
const checkout = (shop: Shop, body: Json) =>
  call(checkoutRoute as Handler, shop, "POST", "/api/sales/checkout", body);
const iOf = (r: { json: Json }) => r.json.invoice as InvoiceJson;
const paySale = (shop: Shop, id: string, body: Json) =>
  call(
    paySaleRoute as Handler,
    shop,
    "POST",
    `/api/sales/${id}/payments`,
    body,
    id,
  );
const ret = (shop: Shop, id: string, body: Json) =>
  call(
    returnRoute as Handler,
    shop,
    "POST",
    `/api/sales/${id}/returns`,
    body,
    id,
  );
const op = () => crypto.randomUUID();

beforeAll(() => f.setup());
afterAll(() => f.teardown());

describe("QA-30 — supplier purchases", () => {
  it("a purchase puts stock in, raises «عليك» by the server total, and records a partial payment", async () => {
    const sup = await person(A, "suppliers", "مورد شراء");
    const cola = await f.product(A, { name: "كولا شراء", sell: 1000 });
    const cheese = await f.product(A, {
      name: "جبنة شراء",
      unit: "kg",
      sell: 20000,
    });
    const r = await buy(A, {
      opId: op(),
      supplierId: sup,
      lines: [
        {
          storeVariantId: cola.variantId,
          quantityBase: 24,
          totalCostPiasters: 16800,
        },
        {
          storeVariantId: cheese.variantId,
          quantityBase: 2000,
          totalCostPiasters: 30000,
          expiryDate: "2027-01-31",
        },
      ],
      paidNowPiasters: 20000,
    });
    expect(r.status).toBe(201);
    const p = pOf(r);
    expect(p.totalPiasters).toBe(46800); // the sum of the lines, computed by the server
    expect(p.paidPiasters).toBe(20000);
    expect(p.outstandingPiasters).toBe(26800);
    expect((await f.stockState(A, cola.variantId)).level).toBe(24);
    expect((await f.stockState(A, cheese.variantId)).level).toBe(2000);
    const batch = await f.as(A, (tx) =>
      tx.storeStockBatch.findUniqueOrThrow({
        where: { id: p.lines[1]!.batchId },
      }),
    );
    expect(Number(batch.costTotalMinor)).toBe(30000);
    expect(Number(batch.costPriceMinor)).toBe(15000); // per kg
    expect(batch.supplierId).toBe(sup);
    expect(await balanceOf(A, sup)).toBe(26800);
  });

  it("a retry records once (sequential and concurrent); the same opId with another invoice is a 409", async () => {
    const sup = await person(A, "suppliers", "مورد تكرار");
    const v = await f.product(A, { name: "صنف تكرار", sell: 500 });
    const body = {
      opId: op(),
      supplierId: sup,
      lines: [
        {
          storeVariantId: v.variantId,
          quantityBase: 10,
          totalCostPiasters: 3000,
        },
      ],
    };
    const results = await Promise.all([1, 2, 3].map(() => buy(A, body)));
    expect(results.every((x) => x.status === 200 || x.status === 201)).toBe(
      true,
    );
    expect(new Set(results.map((x) => pOf(x).id)).size).toBe(1);
    expect((await buy(A, body)).json.purchase).toMatchObject({
      duplicate: true,
    });
    expect((await f.stockState(A, v.variantId)).level).toBe(10);
    expect(await balanceOf(A, sup)).toBe(3000);
    const other = await buy(A, {
      ...body,
      lines: [
        {
          storeVariantId: v.variantId,
          quantityBase: 11,
          totalCostPiasters: 3000,
        },
      ],
    });
    expect(other.status).toBe(409);
    expect((await f.stockState(A, v.variantId)).level).toBe(10);
  });

  it("payments are linked to the invoice and cannot exceed what it still owes", async () => {
    const sup = await person(A, "suppliers", "مورد دفعات");
    const v = await f.product(A, { name: "صنف دفعات", sell: 500 });
    const p = pOf(
      await buy(A, {
        opId: op(),
        supplierId: sup,
        lines: [
          {
            storeVariantId: v.variantId,
            quantityBase: 5,
            totalCostPiasters: 10000,
          },
        ],
      }),
    );
    const payOp = op();
    expect(
      (await payP(A, p.id, { opId: payOp, amountPiasters: 4000 })).status,
    ).toBe(201);
    const replay = await payP(A, p.id, { opId: payOp, amountPiasters: 4000 });
    expect(replay.status).toBe(200);
    expect(pOf(replay).outstandingPiasters).toBe(6000);
    expect(
      (await payP(A, p.id, { opId: op(), amountPiasters: 6001 })).status,
    ).toBe(400);
    expect(
      (await payP(A, p.id, { opId: payOp, amountPiasters: 5000 })).status,
    ).toBe(409);
    const last = await payP(A, p.id, { opId: op(), amountPiasters: 6000 });
    expect(pOf(last).outstandingPiasters).toBe(0);
    expect(pOf(last).paidPiasters).toBe(10000);
    const linked = await f.as(A, (tx) =>
      tx.debtEntry.findMany({
        where: { storeId: A.storeId, purchaseId: p.id },
      }),
    );
    expect(linked).toHaveLength(3); // the invoice debt + 2 payments
    expect(linked.filter((e) => e.settlesEntryId !== null)).toHaveLength(2);
    expect(await balanceOf(A, sup)).toBe(0);
  });

  it("cancelling reverses stock and debt atomically; refused once its stock was used; a retry is the same cancel", async () => {
    const sup = await person(A, "suppliers", "مورد إلغاء");
    const v = await f.product(A, { name: "صنف إلغاء", sell: 1000 });
    const used = pOf(
      await buy(A, {
        opId: op(),
        supplierId: sup,
        lines: [
          {
            storeVariantId: v.variantId,
            quantityBase: 4,
            totalCostPiasters: 2000,
          },
        ],
      }),
    );
    expect((await f.sell(A, v.variantId, 1)).status).toBe(200);
    const refused = await voidP(A, used.id, { opId: op() });
    expect(refused.status).toBe(409);
    expect((await f.stockState(A, v.variantId)).level).toBe(3);

    const clean = pOf(
      await buy(A, {
        opId: op(),
        supplierId: sup,
        lines: [
          {
            storeVariantId: v.variantId,
            quantityBase: 6,
            totalCostPiasters: 3000,
          },
        ],
        paidNowPiasters: 1000,
      }),
    );
    expect(await balanceOf(A, sup)).toBe(2000 + 2000);
    const voidOp = op();
    const done = await voidP(A, clean.id, {
      opId: voidOp,
      reason: "رجّعنا البضاعة",
    });
    expect(done.status).toBe(200);
    expect(pOf(done)).toMatchObject({ voided: true, outstandingPiasters: 0 });
    expect((await f.stockState(A, v.variantId)).level).toBe(3);
    // The 2000 still owed on the used invoice; the cancelled one's 1000 payment is a credit.
    expect(await balanceOf(A, sup)).toBe(2000 - 1000);
    const again = await voidP(A, clean.id, { opId: voidOp });
    expect(pOf(again).duplicate).toBe(true);
    expect((await f.stockState(A, v.variantId)).level).toBe(3);
    expect(
      (await payP(A, clean.id, { opId: op(), amountPiasters: 1 })).status,
    ).toBe(409);
    const state = await f.stockState(A, v.variantId);
    expect(state.level).toBe(state.batchesRemaining);
    expect(state.level).toBe(state.movementsSum);
  });

  it("invalid invoices are refused: client total, no lines, overpaid, a service item", async () => {
    const sup = await person(A, "suppliers", "مورد غلط");
    const v = await f.product(A, { name: "صنف غلط", sell: 500 });
    const svc = await f.product(A, {
      name: "شحن غلط",
      sell: 0,
      category: "شحن رصيد",
    });
    const line = {
      storeVariantId: v.variantId,
      quantityBase: 1,
      totalCostPiasters: 100,
    };
    for (const body of [
      { opId: op(), supplierId: sup, lines: [line], totalPiasters: 1 },
      { opId: op(), supplierId: sup, lines: [] },
      { opId: op(), supplierId: sup, lines: [line], paidNowPiasters: 101 },
      {
        opId: op(),
        supplierId: sup,
        lines: [{ ...line, totalCostPiasters: -1 }],
      },
      {
        opId: op(),
        supplierId: sup,
        lines: [{ ...line, storeVariantId: svc.variantId }],
      },
    ]) {
      expect((await buy(A, body)).status).toBe(400);
    }
    expect((await f.stockState(A, v.variantId)).level).toBe(0);
  });

  it("tenant isolation: another shop's supplier, product or purchase is not found", async () => {
    const supA = await person(A, "suppliers", "مورد أ");
    const vA = await f.product(A, { name: "صنف أ", sell: 500 });
    const vB = await f.product(B, { name: "صنف ب", sell: 500 });
    const pA = pOf(
      await buy(A, {
        opId: op(),
        supplierId: supA,
        lines: [
          {
            storeVariantId: vA.variantId,
            quantityBase: 2,
            totalCostPiasters: 400,
          },
        ],
      }),
    );
    expect(
      (
        await buy(B, {
          opId: op(),
          supplierId: supA,
          lines: [
            {
              storeVariantId: vB.variantId,
              quantityBase: 1,
              totalCostPiasters: 1,
            },
          ],
        })
      ).status,
    ).toBe(404);
    const supB = await person(B, "suppliers", "مورد ب");
    expect(
      (
        await buy(B, {
          opId: op(),
          supplierId: supB,
          lines: [
            {
              storeVariantId: vA.variantId,
              quantityBase: 1,
              totalCostPiasters: 1,
            },
          ],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          getPurchaseRoute as Handler,
          B,
          "GET",
          `/api/purchases/${pA.id}`,
          undefined,
          pA.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (await payP(B, pA.id, { opId: op(), amountPiasters: 1 })).status,
    ).toBe(404);
    expect((await voidP(B, pA.id, { opId: op() })).status).toBe(404);
    const listB = await call(
      purchases.GET as Handler,
      B,
      "GET",
      "/api/purchases",
    );
    expect(
      (listB.json.purchases as PurchaseJson[]).some((p) => p.id === pA.id),
    ).toBe(false);
    expect((await f.stockState(A, vA.variantId)).level).toBe(2);
  });
});

describe("QA-31 — cart checkout, discounts and payment methods", () => {
  it("prices every line on the server, splits the discount, keeps unit prices, takes the stock", async () => {
    const tea = await f.product(A, { name: "شاي سلة", sell: 1250 });
    const sugar = await f.product(A, {
      name: "سكر سلة",
      unit: "kg",
      sell: 3000,
    });
    await f.addStock(A, tea.variantId, 10);
    await f.addStock(A, sugar.variantId, 5000);
    const r = await checkout(A, {
      opId: op(),
      lines: [
        { variantId: tea.variantId, quantityBase: 3 },
        { variantId: sugar.variantId, quantityBase: 1500 },
        { variantId: tea.variantId, quantityBase: 1 }, // the same item twice is one line
      ],
      discountPiasters: 1000,
      paymentMethod: "card",
    });
    expect(r.status).toBe(201);
    const inv = iOf(r);
    expect(inv.paymentMethod).toBe("card");
    expect(inv.subtotalPiasters).toBe(4 * 1250 + 4500); // 1.5 kg × 30.00
    expect(inv.discountPiasters).toBe(1000);
    expect(inv.totalPiasters).toBe(9500 - 1000);
    expect(inv.lines).toHaveLength(2);
    expect(inv.lines.map((l) => l.unitPricePiasters).sort()).toEqual([
      1250, 3000,
    ]);
    expect(inv.lines.reduce((s, l) => s + l.discountPiasters, 0)).toBe(1000);
    expect(inv.lines.reduce((s, l) => s + l.totalPiasters, 0)).toBe(
      inv.totalPiasters,
    );
    expect((await f.stockState(A, tea.variantId)).level).toBe(6);
    expect((await f.stockState(A, sugar.variantId)).level).toBe(3500);
    const row = (await f.salesOf(A)).find((s) => s.id === inv.id)!;
    expect(row.paymentMethod).toBe("card");
    expect(Number(row.discountPiasters)).toBe(1000);
  });

  it("refuses client totals, invalid discounts and methods, shortages — and writes nothing", async () => {
    const v = await f.product(A, { name: "صنف رفض", sell: 1000 });
    await f.addStock(A, v.variantId, 2);
    const line = [{ variantId: v.variantId, quantityBase: 1 }];
    const before = (await f.salesOf(A)).length;
    for (const body of [
      { opId: op(), lines: line, paymentMethod: "cash", totalPiasters: 1 },
      {
        opId: op(),
        lines: line,
        paymentMethod: "cash",
        discountPiasters: 1000,
      },
      { opId: op(), lines: line, paymentMethod: "cash", discountPiasters: -1 },
      { opId: op(), lines: line, paymentMethod: "bitcoin" },
      { opId: op(), lines: line, paymentMethod: "debt" },
      { opId: op(), lines: [], paymentMethod: "cash" },
    ]) {
      expect((await checkout(A, body)).status).toBe(400);
    }
    const short = await checkout(A, {
      opId: op(),
      lines: [{ variantId: v.variantId, quantityBase: 3 }],
      paymentMethod: "cash",
    });
    expect(short.status).toBe(409);
    expect((await f.salesOf(A)).length).toBe(before);
    expect((await f.stockState(A, v.variantId)).level).toBe(2);
  });

  it("a retried checkout is one sale; the same opId with another cart is a 409", async () => {
    const v = await f.product(A, { name: "صنف تكرار سلة", sell: 1000 });
    await f.addStock(A, v.variantId, 10);
    const body = {
      opId: op(),
      lines: [{ variantId: v.variantId, quantityBase: 2 }],
      paymentMethod: "wallet",
    };
    const results = await Promise.all([1, 2, 3].map(() => checkout(A, body)));
    expect(new Set(results.map((x) => iOf(x).id)).size).toBe(1);
    expect((await f.stockState(A, v.variantId)).level).toBe(8);
    expect(
      (
        await checkout(A, {
          ...body,
          lines: [{ variantId: v.variantId, quantityBase: 3 }],
        })
      ).status,
    ).toBe(409);
    expect((await f.stockState(A, v.variantId)).level).toBe(8);
  });

  it("a single sale stores the payment method it was paid with", async () => {
    const v = await f.product(A, { name: "صنف محفظة", sell: 1000 });
    await f.addStock(A, v.variantId, 1);
    const r = await f.sell(A, v.variantId, 1, { paymentMethod: "wallet" });
    expect(r.status).toBe(200);
    const id = (r.json.data as { id: string }).id;
    expect((await f.salesOf(A)).find((s) => s.id === id)!.paymentMethod).toBe(
      "wallet",
    );
    expect(
      (await f.sell(A, v.variantId, 1, { paymentMethod: "debt" })).status,
    ).toBe(400);
  });
});

describe("QA-31 — credit sales", () => {
  it("creates the invoice and the receivable together; payments are linked and bounded", async () => {
    const cust = await person(A, "owedToMe", "زبون آجل");
    const v = await f.product(A, { name: "صنف آجل", sell: 2500 });
    await f.addStock(A, v.variantId, 10);
    const r = await checkout(A, {
      opId: op(),
      lines: [{ variantId: v.variantId, quantityBase: 4 }],
      paymentMethod: "debt",
      customerId: cust,
      paidNowPiasters: 3000,
    });
    expect(r.status).toBe(201);
    const inv = iOf(r);
    expect(inv.totalPiasters).toBe(10000);
    expect(inv.outstandingPiasters).toBe(7000);
    expect(await balanceOf(A, cust)).toBe(7000);
    const entries = await f.as(A, (tx) =>
      tx.debtEntry.findMany({ where: { storeId: A.storeId, saleId: inv.id } }),
    );
    expect(entries).toHaveLength(2);

    expect(
      (await paySale(A, inv.id, { opId: op(), amountPiasters: 7001 })).status,
    ).toBe(400);
    const pOp = op();
    const part = await paySale(A, inv.id, { opId: pOp, amountPiasters: 2000 });
    expect(iOf(part).outstandingPiasters).toBe(5000);
    expect(
      iOf(await paySale(A, inv.id, { opId: pOp, amountPiasters: 2000 }))
        .duplicate,
    ).toBe(true);
    const rest = await paySale(A, inv.id, { opId: op(), amountPiasters: 5000 });
    expect(iOf(rest).outstandingPiasters).toBe(0);
    expect(await balanceOf(A, cust)).toBe(0);
    // Revenue is the invoice, at invoice time — payments are not revenue.
    const overview = (await f.request(A, "GET")).json;
    expect(
      (overview.sales as Array<{ id: string; amountPiasters: number }>).find(
        (s) => s.id === inv.id,
      )!.amountPiasters,
    ).toBe(10000);
  });

  it("a cash sale cannot be paid as a credit invoice; a customer of another shop is not found", async () => {
    const v = await f.product(A, { name: "صنف كاش", sell: 1000 });
    await f.addStock(A, v.variantId, 2);
    const cash = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 1 }],
        paymentMethod: "cash",
      }),
    );
    expect(
      (await paySale(A, cash.id, { opId: op(), amountPiasters: 100 })).status,
    ).toBe(400);
    const custB = await person(B, "owedToMe", "زبون ب");
    expect(
      (
        await checkout(A, {
          opId: op(),
          lines: [{ variantId: v.variantId, quantityBase: 1 }],
          paymentMethod: "debt",
          customerId: custB,
        })
      ).status,
    ).toBe(404);
    expect(
      (await paySale(B, cash.id, { opId: op(), amountPiasters: 100 })).status,
    ).toBe(404);
  });

  it("voiding a credit sale reverses its receivable (payments stay as the customer's credit)", async () => {
    const cust = await person(A, "owedToMe", "زبون إلغاء");
    const v = await f.product(A, { name: "صنف إلغاء آجل", sell: 1000 });
    await f.addStock(A, v.variantId, 5);
    const inv = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 3 }],
        paymentMethod: "debt",
        customerId: cust,
        paidNowPiasters: 1000,
      }),
    );
    expect(await balanceOf(A, cust)).toBe(2000);
    expect((await f.void(A, { saleId: inv.id })).status).toBe(200);
    expect(await balanceOf(A, cust)).toBe(-1000); // the 10.00 paid is now owed back
    expect((await f.stockState(A, v.variantId)).level).toBe(5);
  });
});

describe("QA-31 — returns", () => {
  it("returns part of a line at its sold value, puts the stock back, and never more than was sold", async () => {
    const v = await f.product(A, { name: "صنف مرتجع", sell: 1000 });
    await f.addStock(A, v.variantId, 10);
    const inv = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 3 }],
        discountPiasters: 1,
        paymentMethod: "cash",
      }),
    );
    expect(inv.totalPiasters).toBe(2999);
    const lineId = inv.lines[0]!.id;
    const first = await ret(A, inv.id, {
      opId: op(),
      lines: [{ saleLineId: lineId, quantityBase: 1 }],
    });
    expect(first.status).toBe(201);
    expect(iOf(first).returnedPiasters).toBe(999); // floor(2999 × 1/3)
    expect((await f.stockState(A, v.variantId)).level).toBe(8);
    expect(
      (
        await ret(A, inv.id, {
          opId: op(),
          lines: [{ saleLineId: lineId, quantityBase: 3 }],
        })
      ).status,
    ).toBe(400);
    const rest = await ret(A, inv.id, {
      opId: op(),
      lines: [{ saleLineId: lineId, quantityBase: 2 }],
    });
    expect(iOf(rest).returnedPiasters).toBe(2999); // the full line total, exactly
    expect(iOf(rest).lines[0]!.returnedQuantityBase).toBe(3);
    expect((await f.stockState(A, v.variantId)).level).toBe(10);
    const state = await f.stockState(A, v.variantId);
    expect(state.batchesRemaining).toBe(10);
    expect(state.movementsSum).toBe(10);
    expect(
      (
        await ret(A, inv.id, {
          opId: op(),
          lines: [{ saleLineId: lineId, quantityBase: 1 }],
        })
      ).status,
    ).toBe(400);
  });

  it("a repeated return request is applied once (sequential and concurrent)", async () => {
    const v = await f.product(A, { name: "صنف مرتجع مكرر", sell: 1000 });
    await f.addStock(A, v.variantId, 5);
    const inv = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 4 }],
        paymentMethod: "cash",
      }),
    );
    const body = {
      opId: op(),
      lines: [{ saleLineId: inv.lines[0]!.id, quantityBase: 1 }],
    };
    const results = await Promise.all(
      [1, 2, 3].map(() => ret(A, inv.id, body)),
    );
    expect(results.every((x) => x.status === 200 || x.status === 201)).toBe(
      true,
    );
    const after = iOf(
      await call(
        invoiceRoute as Handler,
        A,
        "GET",
        `/api/sales/${inv.id}`,
        undefined,
        inv.id,
      ),
    );
    expect(after.returnedPiasters).toBe(1000);
    expect((await f.stockState(A, v.variantId)).level).toBe(2);
    expect(
      (
        await ret(A, inv.id, {
          ...body,
          lines: [{ saleLineId: inv.lines[0]!.id, quantityBase: 2 }],
        })
      ).status,
    ).toBe(409);
  });

  it("a credit return first lowers what is owed, the rest is refunded; sales totals are net of returns", async () => {
    const cust = await person(A, "owedToMe", "زبون مرتجع");
    const v = await f.product(A, { name: "صنف مرتجع آجل", sell: 1000 });
    await f.addStock(A, v.variantId, 5);
    const inv = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 4 }],
        paymentMethod: "debt",
        customerId: cust,
        paidNowPiasters: 3000,
      }),
    );
    expect(inv.outstandingPiasters).toBe(1000);
    const before = (await f.request(A, "GET")).json
      .todayTotalPiasters as number;
    const r = await ret(A, inv.id, {
      opId: op(),
      lines: [{ saleLineId: inv.lines[0]!.id, quantityBase: 2 }],
    });
    expect(iOf(r).outstandingPiasters).toBe(0);
    const row = await f.as(A, (tx) =>
      tx.saleReturn.findFirstOrThrow({
        where: { storeId: A.storeId, saleId: inv.id },
      }),
    );
    expect(Number(row.creditedPiasters)).toBe(1000);
    expect(Number(row.refundedPiasters)).toBe(1000);
    expect(await balanceOf(A, cust)).toBe(0);
    expect((await f.request(A, "GET")).json.todayTotalPiasters as number).toBe(
      before - 2000,
    );
  });

  it("a voided sale cannot be returned, a returned sale cannot be voided, another shop cannot return", async () => {
    const v = await f.product(A, { name: "صنف قواعد مرتجع", sell: 1000 });
    await f.addStock(A, v.variantId, 6);
    const voided = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 1 }],
        paymentMethod: "cash",
      }),
    );
    expect((await f.void(A, { saleId: voided.id })).status).toBe(200);
    expect(
      (
        await ret(A, voided.id, {
          opId: op(),
          lines: [{ saleLineId: voided.lines[0]!.id, quantityBase: 1 }],
        })
      ).status,
    ).toBe(409);
    const returned = iOf(
      await checkout(A, {
        opId: op(),
        lines: [{ variantId: v.variantId, quantityBase: 2 }],
        paymentMethod: "cash",
      }),
    );
    expect(
      (
        await ret(A, returned.id, {
          opId: op(),
          lines: [{ saleLineId: returned.lines[0]!.id, quantityBase: 1 }],
        })
      ).status,
    ).toBe(201);
    expect((await f.void(A, { saleId: returned.id })).status).toBe(409);
    expect(
      (
        await ret(B, returned.id, {
          opId: op(),
          lines: [{ saleLineId: returned.lines[0]!.id, quantityBase: 1 }],
        })
      ).status,
    ).toBe(404);
    // A line of another sale is not this sale's line.
    expect(
      (
        await ret(A, returned.id, {
          opId: op(),
          lines: [{ saleLineId: voided.lines[0]!.id, quantityBase: 1 }],
        })
      ).status,
    ).toBe(400);
    expect((await f.stockState(A, v.variantId)).level).toBe(6 - 2 + 1);
    // RLS: shop B reads none of shop A's returns.
    const seen = await withTenant(B.storeId, B.userId, (tx) =>
      tx.saleReturn.findMany({ where: { saleId: returned.id } }),
    );
    expect(seen).toHaveLength(0);
  });
});
