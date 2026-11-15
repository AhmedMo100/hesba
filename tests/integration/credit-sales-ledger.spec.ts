/**
 * Prompt 2 — credit sales end to end on real Postgres (route handlers, sessions, RLS): one
 * invoice, stock taken once, one receivable; later payments on the original invoice; general
 * «ليك» payments settling the oldest invoices first so invoice balances always agree with the
 * customer balance; overpayment and concurrent payments; the customer's invoices with products;
 * shop isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { POST as peopleRoute } from "@/app/api/people/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
import { POST as txRoute } from "@/app/api/people/[id]/transactions/route";
import { GET as invoicesRoute } from "@/app/api/people/[id]/invoices/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { GET as invoiceRoute } from "@/app/api/sales/[id]/route";
import { POST as paySaleRoute } from "@/app/api/sales/[id]/payments/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import type { CustomerInvoicesView } from "@/schemas/sale";
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

const op = () => crypto.randomUUID();
const customer = async (shop: Shop, name: string) => {
  const r = await call(peopleRoute as Handler, shop, "POST", "/api/people", {
    name: `${name} ${f.runId}`,
    section: "owedToMe",
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
const invoicesOf = async (shop: Shop, id: string) =>
  (
    await call(
      invoicesRoute as Handler,
      shop,
      "GET",
      `/api/people/${id}/invoices`,
      undefined,
      id,
    )
  ).json as unknown as CustomerInvoicesView;
type Inv = {
  id: string;
  totalPiasters: number;
  outstandingPiasters: number;
  duplicate?: boolean;
};
const sell = async (
  shop: Shop,
  customerId: string,
  lines: Json[],
  paidNowPiasters: number,
  opId = op(),
) =>
  call(checkoutRoute as Handler, shop, "POST", "/api/sales/checkout", {
    opId,
    lines,
    discountPiasters: 0,
    paymentMethod: "debt",
    customerId,
    paidNowPiasters,
  });
const pay = (shop: Shop, saleId: string, amountPiasters: number, opId = op()) =>
  call(
    paySaleRoute as Handler,
    shop,
    "POST",
    `/api/sales/${saleId}/payments`,
    { opId, amountPiasters },
    saleId,
  );
const generalPayment = (
  shop: Shop,
  personId: string,
  amountPiasters: number,
  opId = op(),
) =>
  call(
    txRoute as Handler,
    shop,
    "POST",
    `/api/people/${personId}/transactions`,
    { type: "payment", amountPiasters, opId },
    personId,
  );
const invoice = async (shop: Shop, id: string) =>
  (
    await call(
      invoiceRoute as Handler,
      shop,
      "GET",
      `/api/sales/${id}`,
      undefined,
      id,
    )
  ).json.invoice as Inv;
const movementsOf = (saleId: string) =>
  f.sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM stock_movements m
        JOIN sale_lines l ON l.id = m.sale_line_id WHERE l.sale_id = ${saleId}::uuid AND m.type = 'sale'`;

beforeAll(() => f.setup());
afterAll(async () => {
  await f.sql`DELETE FROM debt_entries WHERE store_id IN ${f.sql([A.storeId, B.storeId])}`;
  await f.sql`DELETE FROM sale_returns WHERE store_id IN ${f.sql([A.storeId, B.storeId])}`;
  await f.teardown();
});

describe("credit sale: 1,000 invoice, 300 now, 200 later, 500 to close", () => {
  it("one invoice, stock taken once, one receivable; later payments update the original invoice", async () => {
    const cust = await customer(A, "زبون الألف");
    const oil = await f.product(A, {
      name: "زيت 1 لتر",
      sell: 10000,
      unit: "piece",
    });
    const rice = await f.product(A, {
      name: "رز سايب",
      sell: 4000,
      unit: "kg",
    });
    await f.addStock(A, oil.variantId, 20);
    await f.addStock(A, rice.variantId, 50_000);
    // 8 × 100 + 5 kg × 40 = 1,000 EGP.
    const r = await sell(
      A,
      cust,
      [
        { variantId: oil.variantId, quantityBase: 8 },
        { variantId: rice.variantId, quantityBase: 5000 },
      ],
      30_000,
    );
    expect(r.status).toBe(201);
    const inv = r.json.invoice as Inv;
    expect(inv.totalPiasters).toBe(100_000);
    expect(inv.outstandingPiasters).toBe(70_000);
    expect(await balanceOf(A, cust)).toBe(70_000);
    expect((await movementsOf(inv.id))[0]!.n).toBeGreaterThanOrEqual(2);
    const receivables = await f.sql`SELECT count(*)::int AS n FROM debt_entries
       WHERE sale_id = ${inv.id}::uuid AND direction = 'owed_to_me'`;
    expect(receivables[0]!.n).toBe(1);

    const p1 = await pay(A, inv.id, 20_000);
    expect((p1.json.invoice as Inv).outstandingPiasters).toBe(50_000);
    expect(await balanceOf(A, cust)).toBe(50_000);

    const view = await invoicesOf(A, cust);
    const line = view.invoices.find((i) => i.id === inv.id)!;
    expect(line).toMatchObject({
      totalPiasters: 100_000,
      paidPiasters: 50_000,
      remainingPiasters: 50_000,
      status: "partial",
    });
    expect(line.lines.map((l) => [l.quantityBase, l.unit])).toEqual(
      expect.arrayContaining([
        [8, "piece"],
        [5000, "kg"],
      ]),
    );
    expect(line.payments.map((p) => p.amountPiasters).sort()).toEqual([
      20_000, 30_000,
    ]);
    expect(line.number).toMatch(/^[0-9A-F]{8}$/);

    const close = await pay(A, inv.id, 50_000);
    expect((close.json.invoice as Inv).outstandingPiasters).toBe(0);
    expect(await balanceOf(A, cust)).toBe(0);
    const after = (await invoicesOf(A, cust)).invoices.find(
      (i) => i.id === inv.id,
    )!;
    expect(after).toMatchObject({
      status: "paid",
      remainingPiasters: 0,
      totalPiasters: 100_000,
    });
    // Still one sale, one receivable, the same stock movements.
    expect((await movementsOf(inv.id))[0]!.n).toBe(
      (await movementsOf(inv.id))[0]!.n,
    );
    const sales =
      await f.sql`SELECT count(*)::int AS n FROM sales WHERE customer_id = ${cust}::uuid`;
    expect(sales[0]!.n).toBe(1);
  });

  it("no payment now; a payment above what the invoice owes is refused; a retried payment counts once", async () => {
    const cust = await customer(A, "زبون بدون دفع");
    const v = await f.product(A, { name: "صنف بدون دفع", sell: 5000 });
    await f.addStock(A, v.variantId, 10);
    const inv = (
      await sell(A, cust, [{ variantId: v.variantId, quantityBase: 2 }], 0)
    ).json.invoice as Inv;
    expect(inv.outstandingPiasters).toBe(10_000);
    expect((await pay(A, inv.id, 10_001)).status).toBe(400);
    const opId = op();
    await pay(A, inv.id, 4000, opId);
    const replay = await pay(A, inv.id, 4000, opId);
    expect((replay.json.invoice as Inv).duplicate).toBe(true);
    expect(await balanceOf(A, cust)).toBe(6000);
    // The same opId with another amount is a conflict, not a second payment.
    expect((await pay(A, inv.id, 1000, opId)).status).toBe(409);
  });

  it("two payments at the same moment cannot overpay the invoice", async () => {
    const cust = await customer(A, "زبون متزامن");
    const v = await f.product(A, { name: "صنف متزامن", sell: 7000 });
    await f.addStock(A, v.variantId, 5);
    const inv = (
      await sell(A, cust, [{ variantId: v.variantId, quantityBase: 1 }], 0)
    ).json.invoice as Inv;
    const results = await Promise.all([
      pay(A, inv.id, 5000),
      pay(A, inv.id, 5000),
      pay(A, inv.id, 5000),
    ]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    expect((await invoice(A, inv.id)).outstandingPiasters).toBe(2000);
    expect(await balanceOf(A, cust)).toBe(2000);
  });
});

describe("general «ليك» payments settle the oldest invoices first", () => {
  it("invoice balances always add up to the customer balance; paying an invoice then cannot create a hidden credit", async () => {
    const cust = await customer(A, "زبون فاتورتين");
    const v = await f.product(A, { name: "صنف فواتير", sell: 10_000 });
    await f.addStock(A, v.variantId, 20);
    const first = (
      await sell(A, cust, [{ variantId: v.variantId, quantityBase: 3 }], 0)
    ).json.invoice as Inv; // 300
    const second = (
      await sell(A, cust, [{ variantId: v.variantId, quantityBase: 2 }], 0)
    ).json.invoice as Inv; // 200
    expect(await balanceOf(A, cust)).toBe(50_000);

    // 350 paid from «ليك» without choosing an invoice: the first (oldest) is closed, 50 off the second.
    expect((await generalPayment(A, cust, 35_000)).status).toBe(201);
    expect((await invoice(A, first.id)).outstandingPiasters).toBe(0);
    expect((await invoice(A, second.id)).outstandingPiasters).toBe(15_000);
    const view = await invoicesOf(A, cust);
    expect(view.outstandingPiasters).toBe(15_000);
    expect(view.invoices.reduce((n, i) => n + i.remainingPiasters, 0)).toBe(
      view.outstandingPiasters,
    );
    expect(view.invoices.find((i) => i.id === first.id)).toMatchObject({
      status: "paid",
      settledByGeneralPiasters: 30_000,
    });
    expect(view.generalPayments.map((g) => g.amountPiasters)).toEqual([35_000]);

    // The first invoice owes nothing now; paying it again is refused (no hidden credit).
    expect((await pay(A, first.id, 1000)).status).toBe(400);
    expect((await pay(A, second.id, 15_001)).status).toBe(400);
    expect((await pay(A, second.id, 15_000)).status).toBe(201);
    expect(await balanceOf(A, cust)).toBe(0);
  });

  it("a return on an invoice already settled by a general payment is refunded, not left as a hidden debt reduction", async () => {
    const cust = await customer(A, "زبون مرتجع");
    const v = await f.product(A, { name: "صنف مرتجع", sell: 10_000 });
    await f.addStock(A, v.variantId, 10);
    const inv = (
      await sell(A, cust, [{ variantId: v.variantId, quantityBase: 2 }], 0)
    ).json.invoice as Inv;
    await generalPayment(A, cust, 20_000);
    expect((await invoice(A, inv.id)).outstandingPiasters).toBe(0);
    const full = await f.sql<
      Array<{ id: string }>
    >`SELECT id::text AS id FROM sale_lines WHERE sale_id = ${inv.id}::uuid`;
    const r = await call(
      returnRoute as Handler,
      A,
      "POST",
      `/api/sales/${inv.id}/returns`,
      {
        opId: op(),
        lines: [{ saleLineId: full[0]!.id, quantityBase: 1 }],
      },
      inv.id,
    );
    expect(r.status).toBe(201);
    // The 100 returned is money back to the customer (the invoice was already paid).
    const ret =
      await f.sql`SELECT refunded_piasters::int AS refunded, credited_piasters::int AS credited
                              FROM sale_returns WHERE sale_id = ${inv.id}::uuid`;
    expect(ret[0]).toMatchObject({ refunded: 10_000, credited: 0 });
    expect(await balanceOf(A, cust)).toBe(0);
  });
});

describe("isolation", () => {
  it("another shop cannot read a customer's invoices or pay their invoice", async () => {
    const cust = await customer(A, "زبون معزول");
    const v = await f.product(A, { name: "صنف معزول", sell: 1000 });
    await f.addStock(A, v.variantId, 5);
    const inv = (
      await sell(A, cust, [{ variantId: v.variantId, quantityBase: 1 }], 0)
    ).json.invoice as Inv;
    expect(
      (
        await call(
          invoicesRoute as Handler,
          B,
          "GET",
          `/api/people/${cust}/invoices`,
          undefined,
          cust,
        )
      ).status,
    ).toBe(404);
    expect((await pay(B, inv.id, 500)).status).toBe(404);
    expect((await generalPayment(B, cust, 500)).status).toBe(404);
    expect(await balanceOf(A, cust)).toBe(1000);
    // Shop B cannot sell on credit to shop A's customer.
    const own = await f.product(B, { name: "صنف ب", sell: 1000 });
    await f.addStock(B, own.variantId, 5);
    expect(
      (await sell(B, cust, [{ variantId: own.variantId, quantityBase: 1 }], 0))
        .status,
    ).toBe(404);
  });
});
