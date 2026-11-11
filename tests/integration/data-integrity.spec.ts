/**
 * QA-15, QA-16, QA-22, QA-23, QA-27, QA-33 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0025) on the real
 * route handlers, real sessions, app role with RLS (QA-21 is in store-settings-api.spec.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { withTenant } from "@/server/infra/db/tenant";
import { POST as productsRoute } from "@/app/api/products/route";
import { POST as stockRoute } from "@/app/api/stock/route";
import { POST as expensesRoute } from "@/app/api/expenses/route";
import { POST as peopleRoute } from "@/app/api/people/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
import { POST as txRoute } from "@/app/api/people/[id]/transactions/route";
import {
  MAX_AMOUNT_PIASTERS,
  MAX_QUANTITY_BASE,
  MAX_UNIT_PRICE_PIASTERS,
} from "@/domain/limits";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const tokens = new Map<string, string>();

async function call(
  handler: (req: Request, ctx: never) => Promise<Response>,
  shop: Shop,
  path: string,
  body?: unknown,
  id?: string,
): Promise<{ status: number; json: Json }> {
  let token = tokens.get(shop.storeId);
  if (!token) {
    token = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, token);
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `hesba_session=${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: id ?? "" }) } as never,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const stock = (shop: Shop, body: Json) =>
  call(stockRoute as never, shop, "/api/stock", body);
const expense = (shop: Shop, body: Json) =>
  call(expensesRoute as never, shop, "/api/expenses", body);
const person = (shop: Shop, body: Json) =>
  call(peopleRoute as never, shop, "/api/people", body);
const personTx = (shop: Shop, id: string, body: Json) =>
  call(txRoute as never, shop, `/api/people/${id}/transactions`, body, id);
const product = (shop: Shop, name: string, extra: Json = {}) =>
  call(productsRoute as never, shop, "/api/products", {
    nameAr: name,
    category: "مشروبات",
    unit: "piece",
    sellPricePiasters: 1000,
    isCustom: true,
    variants: [{ packQty: 1, sellPricePiasters: 1000 }],
    ...extra,
  });

const expensesOf = (shop: Shop, where: Json = {}) =>
  f.as(shop, (tx) =>
    tx.expense.findMany({ where: { storeId: shop.storeId, ...where } }),
  );

beforeAll(() => f.setup());
afterAll(() => f.teardown());

describe("QA-15 — upper bounds on money and quantities", () => {
  it("stock quantity: the maximum is accepted, one more is a 400", async () => {
    const p = await f.product(A, { name: "حد كمية", sell: 100 });
    const ok = await stock(A, {
      action: "add",
      storeVariantId: p.variantId,
      quantityBase: MAX_QUANTITY_BASE,
    });
    expect(ok.status).toBe(200);
    const over = await stock(A, {
      action: "add",
      storeVariantId: p.variantId,
      quantityBase: MAX_QUANTITY_BASE + 1,
    });
    expect(over.status).toBe(400);
    for (const bad of [0, -1, 1.5, "10"]) {
      const r = await stock(A, {
        action: "add",
        storeVariantId: p.variantId,
        quantityBase: bad,
      });
      expect(r.status).toBe(400);
    }
    expect((await f.stockState(A, p.variantId)).level).toBe(MAX_QUANTITY_BASE);
  });

  it("prices: the maximum unit price is accepted, above it a 400; fractional piasters a 400", async () => {
    const ok = await product(A, `غالي ${f.runId}`, {
      sellPricePiasters: MAX_UNIT_PRICE_PIASTERS,
      variants: [{ packQty: 1, sellPricePiasters: MAX_UNIT_PRICE_PIASTERS }],
    });
    expect(ok.status).toBe(200);
    for (const price of [MAX_UNIT_PRICE_PIASTERS + 1, 10 ** 15, 12.5, -1]) {
      const r = await product(A, `سعر غلط ${price} ${f.runId}`, {
        sellPricePiasters: price,
        variants: [{ packQty: 1, sellPricePiasters: price }],
      });
      expect(r.status).toBe(400);
    }
  });

  it("weighed opening stock is whole grams up to the bound (base units, never rounded)", async () => {
    const ok = await product(A, `جبنة وزن ${f.runId}`, {
      unit: "kg",
      initialQuantity: 255, // 255 g
    });
    expect(ok.status).toBe(200);
    for (const q of [255.5, -1, MAX_QUANTITY_BASE + 1]) {
      const r = await product(A, `جبنة غلط ${q} ${f.runId}`, {
        unit: "kg",
        initialQuantity: q,
      });
      expect(r.status).toBe(400);
    }
  });

  it("expenses: 0.01 EGP and the maximum are accepted; above, zero, negative or fractional are 400", async () => {
    expect(
      (await expense(A, { category: "كهرباء", amountPiasters: 1 })).status,
    ).toBe(201);
    expect(
      (
        await expense(A, {
          category: "كهرباء",
          amountPiasters: MAX_AMOUNT_PIASTERS,
        })
      ).status,
    ).toBe(201);
    for (const amount of [
      MAX_AMOUNT_PIASTERS + 1,
      10 ** 15,
      0,
      -5,
      10.5,
      "100",
    ]) {
      expect(
        (await expense(A, { category: "كهرباء", amountPiasters: amount }))
          .status,
      ).toBe(400);
    }
  });

  it("the database refuses an out-of-range value even when the API is bypassed", async () => {
    await expect(
      withTenant(A.storeId, A.userId, (tx) =>
        tx.expense.create({
          data: {
            storeId: A.storeId,
            category: "كهرباء",
            amountPiasters: BigInt(MAX_AMOUNT_PIASTERS) + BigInt(1),
          },
        }),
      ),
    ).rejects.toThrow(/chk_expenses_amount_bounds/);
  });

  it("a sale's commission cannot be negative", async () => {
    const svc = await f.product(A, {
      name: "خدمة عمولة",
      sell: 500,
      category: "شحن رصيد",
    });
    const r = await f.request(A, "POST", {
      productId: svc.productId,
      amountPiasters: 1000,
      commissionPiasters: -50,
      opId: crypto.randomUUID(),
    });
    expect(r.status).toBe(400);
  });
});

describe("QA-16 — no silent zeroing: oversell and over-adjust are rejected", () => {
  it("selling exactly the stock works; one more is a 409 that changes nothing", async () => {
    const p = await f.product(A, { name: "آخر حتة", sell: 500 });
    await f.addStock(A, p.variantId, 10);
    expect((await f.sell(A, p.variantId, 11)).status).toBe(409);
    const s = await f.stockState(A, p.variantId);
    expect(s.level).toBe(10);
    expect(s.movements.filter((m) => m.type === "sale")).toHaveLength(0);
    expect((await f.sell(A, p.variantId, 10)).status).toBe(200);
    expect((await f.stockState(A, p.variantId)).level).toBe(0);
  });

  it("reducing below zero is a 409: stock, batches and ledger unchanged, no movement written", async () => {
    const p = await f.product(A, { name: "تسوية زيادة", sell: 500 });
    await f.addStock(A, p.variantId, 10);
    const before = await f.stockState(A, p.variantId);
    const r = await stock(A, {
      action: "adjust",
      storeVariantId: p.variantId,
      mode: "delta",
      deltaQuantityBase: -15,
      reason: "جرد",
    });
    expect(r.status).toBe(409);
    expect((r.json.error as { details: Json }).details).toMatchObject({
      availableBase: 10,
      requestedBase: 15,
    });
    const after = await f.stockState(A, p.variantId);
    expect(after).toEqual(before);
    const ok = await stock(A, {
      action: "adjust",
      storeVariantId: p.variantId,
      mode: "delta",
      deltaQuantityBase: -10,
      reason: "جرد",
    });
    expect(ok.status).toBe(200);
    expect((await f.stockState(A, p.variantId)).level).toBe(0);
  });

  it("two concurrent reductions of 6 from 10: exactly one is applied", async () => {
    const p = await f.product(A, { name: "تسوية سباق", sell: 500 });
    await f.addStock(A, p.variantId, 10);
    const results = await Promise.all(
      [1, 2].map(() =>
        stock(A, {
          action: "adjust",
          storeVariantId: p.variantId,
          mode: "delta",
          deltaQuantityBase: -6,
          reason: "جرد",
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const s = await f.stockState(A, p.variantId);
    expect(s.level).toBe(4);
    expect(s.batchesRemaining).toBe(4);
    expect(s.movementsSum).toBe(4);
  });

  it("another store's variant cannot be adjusted", async () => {
    const p = await f.product(A, { name: "تسوية عزل", sell: 500 });
    await f.addStock(A, p.variantId, 5);
    const r = await stock(B, {
      action: "adjust",
      storeVariantId: p.variantId,
      mode: "delta",
      deltaQuantityBase: -1,
      reason: "x",
    });
    expect(r.status).toBe(404);
    expect((await f.stockState(A, p.variantId)).level).toBe(5);
  });
});

describe("QA-22 — one money rule on the People API", () => {
  const balanceOf = async (id: string) =>
    (
      (await call(personRoute as never, A, `/api/people/${id}`, undefined, id))
        .json.person as { amount_piasters: number }
    ).amount_piasters;

  it('amountEgp: "50", "50.00", 50 and 50.00 are all 50.00 EGP; "50.5" is 50.50; "0.50" is 0.50', async () => {
    const cases: Array<[unknown, number]> = [
      ["50", 5000],
      ["50.00", 5000],
      [50, 5000],
      [50.0, 5000],
      ["50.5", 5050],
      ["0.50", 50],
      ["٥٠", 5000],
    ];
    for (const [amountEgp, piasters] of cases) {
      const r = await person(A, {
        name: `زبون ${String(amountEgp)} ${f.runId}`,
        section: "owedToMe",
        amountEgp,
      });
      expect(r.status).toBe(201);
      const id = (r.json.person as { id: string }).id;
      expect(await balanceOf(id)).toBe(piasters);
    }
  });

  it("amountPiasters: integer piasters only — a string or a fraction is a 400, never reinterpreted", async () => {
    const ok = await person(A, {
      name: `زبون قروش ${f.runId}`,
      section: "owedToMe",
      amountPiasters: 5000,
    });
    expect(ok.status).toBe(201);
    expect(await balanceOf((ok.json.person as { id: string }).id)).toBe(5000);
    const zero = await person(A, {
      name: `زبون صفر ${f.runId}`,
      section: "owedToMe",
      amountPiasters: 0,
    });
    expect(zero.status).toBe(201);
    for (const body of [
      { amountPiasters: "50" },
      { amountPiasters: "50.00" },
      { amountPiasters: 10.7 },
      { amountPiasters: -100 },
      { amountPiasters: MAX_AMOUNT_PIASTERS + 1 },
      { amountEgp: "" },
      { amountEgp: "abc" },
      { amountEgp: "50.555" },
      { amountEgp: "-5" },
      { amountEgp: 0.1 + 0.2 },
      { amountEgp: "50", amountPiasters: 5000 },
    ]) {
      const r = await person(A, {
        name: `غلط ${f.runId}`,
        section: "owedToMe",
        ...body,
      });
      expect(r.status).toBe(400);
    }
  });

  it("customer debt and payment, supplier payable and payment: the same rule everywhere", async () => {
    const cust = await person(A, {
      name: `زبون دفتر ${f.runId}`,
      section: "owedToMe",
      amountEgp: "100",
    });
    const cId = (cust.json.person as { id: string }).id;
    expect(
      (await personTx(A, cId, { type: "debt", amountEgp: "50" })).status,
    ).toBe(201);
    expect(
      (await personTx(A, cId, { type: "payment", amountEgp: "30.50" })).status,
    ).toBe(201);
    expect(
      (await personTx(A, cId, { type: "payment", amountPiasters: "10" }))
        .status,
    ).toBe(400);
    expect(
      (await personTx(A, cId, { type: "payment", amountEgp: "0" })).status,
    ).toBe(400);
    expect(await balanceOf(cId)).toBe(10000 + 5000 - 3050);

    const sup = await person(A, {
      name: `مورد دفتر ${f.runId}`,
      section: "suppliers",
      amountEgp: 200,
    });
    const sId = (sup.json.person as { id: string }).id;
    expect(
      (await personTx(A, sId, { type: "payment", amountEgp: "75.25" })).status,
    ).toBe(201);
    expect(
      (await personTx(A, sId, { type: "debt", amountPiasters: 1000 })).status,
    ).toBe(201);
    expect(await balanceOf(sId)).toBe(20000 - 7525 + 1000);
  });
});

describe("QA-23 — products with a name the shop already used", () => {
  it("a second custom product with the same name (any spacing or case) is created, not a 500", async () => {
    const name = `بيبسي تدقيق ${f.runId}`;
    const first = await product(A, name, { sellPricePiasters: 1000 });
    expect(first.status).toBe(200);
    for (const variant of [name, `  ${name}  `, name.toUpperCase()]) {
      const again = await product(A, variant, {
        sellPricePiasters: 1500,
        variants: [{ packQty: 1, sellPricePiasters: 1500 }],
      });
      expect(again.status).toBe(200);
    }
    // The first product's price is untouched.
    const firstId = (first.json.data as { id: string }).id;
    const row = await f.as(A, (tx) =>
      tx.storeProduct.findUniqueOrThrow({ where: { id: firstId } }),
    );
    expect(Number(row.sellPricePiasters)).toBe(1000);
  });

  it("concurrent same-name creations all succeed (no 500)", async () => {
    const name = `سباق اسم ${f.runId}`;
    const results = await Promise.all([1, 2, 3].map(() => product(A, name)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
  });

  it("the same name in another shop is that shop's own product", async () => {
    const name = `اسم مشترك ${f.runId}`;
    const a = await product(A, name);
    const b = await product(B, name);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const bId = (b.json.data as { id: string }).id;
    // Read through the APP role (RLS), not the admin fixture connection.
    const inA = await withTenant(A.storeId, A.userId, (tx) =>
      tx.storeProduct.findFirst({ where: { id: bId } }),
    );
    expect(inA).toBeNull();
  });

  it("existing stock of the first product is unchanged by a same-name product", async () => {
    const p = await f.product(A, { name: "مخزون اسم", sell: 500 });
    await f.addStock(A, p.variantId, 7);
    const name = (
      await f.as(A, (tx) =>
        tx.storeProduct.findUniqueOrThrow({ where: { id: p.productId } }),
      )
    ).nameAr!;
    expect((await product(A, name)).status).toBe(200);
    expect((await f.stockState(A, p.variantId)).level).toBe(7);
  });
});

describe("QA-27 — the same operation id never records twice", () => {
  it("expense: sequential retry and concurrent duplicates → one row; different payload → 409", async () => {
    const opId = crypto.randomUUID();
    const body = { category: "إيجار", amountPiasters: 77700, opId };
    const first = await expense(A, body);
    expect(first.status).toBe(201);
    const retry = await expense(A, body); // the response of the first was "lost"
    expect([200, 201]).toContain(retry.status);
    expect(
      (retry.json.expense as { id: string } | undefined)?.id ?? retry.json.id,
    ).toBeDefined();
    expect(await expensesOf(A, { opId })).toHaveLength(1);

    const concurrentOp = crypto.randomUUID();
    const parallel = await Promise.all(
      [1, 2, 3].map(() =>
        expense(A, {
          category: "إيجار",
          amountPiasters: 777,
          opId: concurrentOp,
        }),
      ),
    );
    expect(parallel.every((r) => r.status < 300)).toBe(true);
    expect(await expensesOf(A, { opId: concurrentOp })).toHaveLength(1);

    const reused = await expense(A, {
      category: "إيجار",
      amountPiasters: 1,
      opId,
    });
    expect(reused.status).toBe(409);
    expect(await expensesOf(A, { opId })).toHaveLength(1);
  });

  it("expense: a failed first attempt leaves nothing behind, and the retry records once", async () => {
    const opId = crypto.randomUUID();
    expect(
      (await expense(A, { category: "إيجار", amountPiasters: -1, opId }))
        .status,
    ).toBe(400);
    expect(await expensesOf(A, { opId })).toHaveLength(0);
    expect(
      (await expense(A, { category: "إيجار", amountPiasters: 500, opId }))
        .status,
    ).toBe(201);
    expect(await expensesOf(A, { opId })).toHaveLength(1);
  });

  it("expense: the same opId in another store is that store's own (no cross-store collision)", async () => {
    const opId = crypto.randomUUID();
    expect(
      (await expense(A, { category: "إيجار", amountPiasters: 100, opId }))
        .status,
    ).toBe(201);
    expect(
      (await expense(B, { category: "إيجار", amountPiasters: 999, opId }))
        .status,
    ).toBe(201);
    expect(await expensesOf(A, { opId })).toHaveLength(1);
    expect(await expensesOf(B, { opId })).toHaveLength(1);
  });

  it("people payment and supplier payment: duplicate → one entry; another amount → 409", async () => {
    for (const section of ["owedToMe", "suppliers"] as const) {
      const p = await person(A, {
        name: `دفع مكرر ${section} ${f.runId}`,
        section,
        amountEgp: "100",
      });
      const id = (p.json.person as { id: string }).id;
      const opId = crypto.randomUUID();
      const results = await Promise.all(
        [1, 2].map(() =>
          personTx(A, id, { type: "payment", amountPiasters: 2000, opId }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const entries = await f.as(A, (tx) =>
        tx.debtEntry.findMany({ where: { storeId: A.storeId, opId } }),
      );
      expect(entries).toHaveLength(1);
      expect(
        (await personTx(A, id, { type: "payment", amountPiasters: 2500, opId }))
          .status,
      ).toBe(409);
    }
  });

  it("stock adjustment: same opId twice → applied once; on another variant → 409", async () => {
    const p = await f.product(A, { name: "تسوية مكررة", sell: 500 });
    const other = await f.product(A, { name: "تسوية تانية", sell: 500 });
    await f.addStock(A, p.variantId, 10);
    await f.addStock(A, other.variantId, 10);
    const opId = crypto.randomUUID();
    const body = {
      action: "adjust",
      storeVariantId: p.variantId,
      mode: "delta",
      deltaQuantityBase: -3,
      reason: "جرد",
      opId,
    };
    expect((await stock(A, body)).status).toBe(200);
    expect((await stock(A, body)).status).toBe(200);
    expect((await f.stockState(A, p.variantId)).level).toBe(7);
    expect(
      (await stock(A, { ...body, storeVariantId: other.variantId })).status,
    ).toBe(409);
    expect((await f.stockState(A, other.variantId)).level).toBe(10);
  });

  it("sale: a lost-response retry returns the same sale and consumes stock once; another quantity → 409", async () => {
    const p = await f.product(A, { name: "بيع مكرر", sell: 1000 });
    await f.addStock(A, p.variantId, 10);
    const opId = crypto.randomUUID();
    const first = await f.sell(A, p.variantId, 2, { opId });
    const retry = await f.sell(A, p.variantId, 2, { opId });
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect((retry.json.data as { id: string }).id).toBe(
      (first.json.data as { id: string }).id,
    );
    expect((retry.json.data as { duplicate: boolean }).duplicate).toBe(true);
    expect((await f.stockState(A, p.variantId)).level).toBe(8);
    expect((await f.sell(A, p.variantId, 5, { opId })).status).toBe(409);
    expect((await f.stockState(A, p.variantId)).level).toBe(8);
  });
});

describe("QA-33 — the server prices and dates every sale", () => {
  it("unit price 10.00 × 3 → unit 10.00, line and invoice 30.00; client amount and time ignored", async () => {
    const p = await f.product(A, { name: "سعر وحدة", sell: 1000 });
    await f.addStock(A, p.variantId, 5);
    const res = await f.sell(A, p.variantId, 3, {
      amountPiasters: 1, // a client total: never trusted
      timestamp: Date.UTC(2100, 0, 1), // a client time: never trusted
    });
    expect(res.status).toBe(200);
    const id = (res.json.data as { id: string }).id;
    const [sale] = (await f.salesOf(A)).filter((s) => s.id === id);
    expect(Number(sale!.totalPiasters)).toBe(3000);
    expect(Math.abs(sale!.createdAt.getTime() - Date.now())).toBeLessThan(
      60_000,
    );
    const line = sale!.saleLines[0]!;
    expect(Number(line.unitPricePiasters)).toBe(1000);
    expect(line.quantityBaseUnits).toBe(3);
    expect(Number(line.totalPiasters)).toBe(3000);
    // Void after an ordinary sale restores the stock exactly.
    expect((await f.void(A, { saleId: id })).status).toBe(200);
    expect((await f.stockState(A, p.variantId)).level).toBe(5);
  });

  it("an unknown product, another store's product and an invalid quantity are rejected", async () => {
    const p = await f.product(B, { name: "منتج غيري", sell: 1000 });
    await f.addStock(B, p.variantId, 5);
    expect((await f.sell(A, crypto.randomUUID(), 1)).status).toBe(404);
    expect((await f.sell(A, p.variantId, 1)).status).toBe(404);
    const own = await f.product(A, { name: "كمية غلط", sell: 1000 });
    for (const q of [0, -1, 1.5, MAX_QUANTITY_BASE + 1]) {
      expect((await f.sell(A, own.variantId, q)).status).toBe(400);
    }
    expect((await f.stockState(B, p.variantId)).level).toBe(5);
  });
});
