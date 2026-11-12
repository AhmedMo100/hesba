/**
 * QA-15, QA-16, QA-22, QA-23, QA-27, QA-33 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0025) on the real
 * route handlers, real sessions, app role with RLS (QA-21 is in store-settings-api.spec.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { withTenant } from "@/server/infra/db/tenant";
import { CatalogService } from "@/server/modules/catalog";
import { POST as productsRoute } from "@/app/api/products/route";
import { POST as stockRoute } from "@/app/api/stock/route";
import { POST as expensesRoute } from "@/app/api/expenses/route";
import { POST as peopleRoute } from "@/app/api/people/route";
import { GET as personRoute } from "@/app/api/people/[id]/route";
import { POST as txRoute } from "@/app/api/people/[id]/transactions/route";
import { DELETE as deleteExpenseRoute } from "@/app/api/expenses/[id]/route";
import { POST as sandwichRoute } from "@/app/api/sandwiches/route";
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

/*
 * Coverage added on review (ADR-0025): the remaining bounds, the global catalog, the other
 * retried writes and the other kinds of sale line.
 */
describe("QA-15 — bounds on the People API and on service amounts", () => {
  it("a person's debt or payment: the maximum is accepted, one piaster more is a 400", async () => {
    const p = await person(A, {
      name: `حد أقصى ${f.runId}`,
      section: "owedToMe",
      amountEgp: "0",
    });
    expect(p.status).toBe(201);
    const id = (p.json.person as { id: string }).id;
    const over = await personTx(A, id, {
      type: "debt",
      amountPiasters: MAX_AMOUNT_PIASTERS + 1,
    });
    expect(over.status).toBe(400);
    const overEgp = await personTx(A, id, {
      type: "debt",
      amountEgp: "10000000.01",
    });
    expect(overEgp.status).toBe(400);
    const max = await personTx(A, id, {
      type: "debt",
      amountPiasters: MAX_AMOUNT_PIASTERS,
    });
    expect(max.status).toBe(201);
    const entries = await f.as(A, (tx) =>
      tx.debtEntry.findMany({
        where: {
          storeId: A.storeId,
          OR: [{ customerId: id }, { contactId: id }],
        },
      }),
    );
    expect(entries.map((e) => Number(e.amountPiasters))).toContain(
      MAX_AMOUNT_PIASTERS,
    );
    expect(
      entries.some((e) => Number(e.amountPiasters) > MAX_AMOUNT_PIASTERS),
    ).toBe(false);
  });

  it("a new person's opening balance above the maximum is a 400 and creates nobody", async () => {
    const name = `رصيد كبير ${f.runId}`;
    const r = await person(A, {
      name,
      section: "suppliers",
      amountPiasters: MAX_AMOUNT_PIASTERS + 1,
    });
    expect(r.status).toBe(400);
    const created = await f.as(A, (tx) =>
      tx.supplier.findMany({ where: { storeId: A.storeId, nameAr: name } }),
    );
    expect(created).toHaveLength(0);
  });

  it("a service sale above the maximum, zero or negative is a 400 and records nothing", async () => {
    const svc = await f.product(A, {
      name: "شحن حد",
      sell: 0,
      category: "شحن رصيد",
    });
    const before = (await f.salesOf(A)).length;
    for (const amountPiasters of [MAX_AMOUNT_PIASTERS + 1, 0, -100]) {
      const r = await f.sell(A, svc.variantId, 1, { amountPiasters });
      expect(r.status).toBe(400);
    }
    expect((await f.salesOf(A)).length).toBe(before);
  });
});

describe("QA-23 — the global catalog is untouched by same-name shop products", () => {
  it("same-name products never create, rename or link a global product; each shop keeps one row per catalog item", async () => {
    const name = `منتج كتالوج ${f.runId}`;
    const [g] = await f.sql<Array<{ id: string }>>`
      INSERT INTO global_products (id, name_ar, name_norm, category, type, status, updated_at)
      VALUES (gen_random_uuid(), ${name}, ${name}, 'مشروبات', 'stock', 'approved', now())
      RETURNING id::text`;
    await f.sql`INSERT INTO global_variants (id, global_product_id, pack_qty, name_norm, updated_at)
      VALUES (gen_random_uuid(), ${g!.id}::uuid, 1, ${name}, now())`;
    const globals = () =>
      f.sql`SELECT id, name_ar, name_norm, status FROM global_products ORDER BY id`;
    const globalsBefore = await globals();
    const linkedTo = (storeId: string) =>
      f.sql`SELECT id FROM store_products
             WHERE global_product_id = ${g!.id}::uuid AND store_id = ${storeId}::uuid`;
    try {
      // Same-name CUSTOM products (the catalog item's name): allowed, and never linked to it.
      for (let i = 0; i < 2; i++) {
        expect((await product(A, name)).status).toBe(200);
      }
      expect(await linkedTo(A.storeId)).toHaveLength(0);

      // Adding the catalog item itself twice (a retried form save): one shop row, updated.
      const asCatalog = (shop: Shop, sell: number) =>
        product(shop, name, {
          isCustom: false,
          globalProductId: g!.id,
          sellPricePiasters: sell,
          variants: [{ packQty: 1, sellPricePiasters: sell }],
        });
      expect((await asCatalog(A, 1100)).status).toBe(200);
      expect((await asCatalog(A, 1200)).status).toBe(200);
      const rowsA = await linkedTo(A.storeId);
      expect(rowsA).toHaveLength(1);
      // Another shop has its own row and price; shop A's price stays shop A's.
      expect((await asCatalog(B, 900)).status).toBe(200);
      expect(await linkedTo(B.storeId)).toHaveLength(1);
      const [priceA] = await f.sql<Array<{ p: string }>>`
        SELECT sell_price_piasters::text AS p FROM store_products WHERE id = ${rowsA[0]!["id"]}`;
      expect(Number(priceA!.p)).toBe(1200);

      // The catalog-matching path (the community flow) refuses a second copy with a 409.
      const catalog = new CatalogService(f.migratorPrisma);
      const add = () =>
        catalog.addStoreProduct({
          storeId: B.storeId,
          userId: B.userId,
          nameAr: name,
          category: "مشروبات",
          unit: "piece",
          sellPricePiasters: BigInt(900),
        });
      await expect(add()).rejects.toMatchObject({ statusCode: 409 });
      expect(await linkedTo(B.storeId)).toHaveLength(1);

      // The global catalog itself is unchanged: no row added, renamed or removed.
      expect(await globals()).toEqual(globalsBefore);
    } finally {
      await f.sql`DELETE FROM store_variants WHERE store_product_id IN (
        SELECT id FROM store_products WHERE global_product_id = ${g!.id}::uuid)`;
      await f.sql`DELETE FROM store_products WHERE global_product_id = ${g!.id}::uuid`;
      await f.sql`DELETE FROM global_variants WHERE global_product_id = ${g!.id}::uuid`;
      await f.sql`DELETE FROM global_products WHERE id = ${g!.id}::uuid`;
    }
  });
});

describe("QA-27 — the other retried writes", () => {
  it("expense delete: a retry gets the same success, the row is deleted once; unknown id is a 404", async () => {
    const created = await expense(A, {
      category: "إيجار",
      amountPiasters: 4200,
      opId: crypto.randomUUID(),
    });
    expect(created.status).toBe(201);
    const id =
      (created.json.expense as { id: string } | undefined)?.id ??
      (created.json.id as string);
    const del = async (expenseId: string) => {
      const token = (await createSession(A.userId, A.storeId)).rawToken;
      const res = await deleteExpenseRoute(
        new Request(`http://localhost:3000/api/expenses/${expenseId}`, {
          method: "DELETE",
          headers: { cookie: `hesba_session=${token}` },
        }),
        { params: Promise.resolve({ id: expenseId }) },
      );
      return res.status;
    };
    expect(await del(id)).toBe(200);
    const deletedAt = (await expensesOf(A, { id }))[0]!.deletedAt;
    expect(deletedAt).not.toBeNull();
    expect(await del(id)).toBe(200); // the first response was "lost"
    expect((await expensesOf(A, { id }))[0]!.deletedAt).toEqual(deletedAt);
    expect(await del(crypto.randomUUID())).toBe(404);
  });

  it("service sale: a retry returns the same sale; another amount with the same opId is a 409", async () => {
    const svc = await f.product(A, {
      name: "شحن مكرر",
      sell: 0,
      category: "شحن رصيد",
    });
    const opId = crypto.randomUUID();
    const first = await f.sell(A, svc.variantId, 1, {
      amountPiasters: 5000,
      opId,
    });
    expect(first.status).toBe(200);
    const retry = await f.sell(A, svc.variantId, 1, {
      amountPiasters: 5000,
      opId,
    });
    expect(retry.status).toBe(200);
    expect((retry.json.data as { duplicate: boolean }).duplicate).toBe(true);
    const other = await f.sell(A, svc.variantId, 1, {
      amountPiasters: 6000,
      opId,
    });
    expect(other.status).toBe(409);
    const recorded = await f.as(A, (tx) =>
      tx.sale.findMany({ where: { storeId: A.storeId, opId } }),
    );
    expect(recorded).toHaveLength(1);
    expect(Number(recorded[0]!.totalPiasters)).toBe(5000);
  });

  it("an ordinary-product retry that also sends a (ignored) client amount is still the same sale", async () => {
    const p = await f.product(A, { name: "مبلغ مهمل", sell: 1000 });
    await f.addStock(A, p.variantId, 5);
    const opId = crypto.randomUUID();
    expect(
      (await f.sell(A, p.variantId, 1, { opId, amountPiasters: 1 })).status,
    ).toBe(200);
    const retry = await f.sell(A, p.variantId, 1, {
      opId,
      amountPiasters: 999,
    });
    expect(retry.status).toBe(200);
    expect((retry.json.data as { duplicate: boolean }).duplicate).toBe(true);
    expect((await f.stockState(A, p.variantId)).level).toBe(4);
  });
});

describe("QA-33 — sandwich, offer and service lines are priced and dated by the server", () => {
  const clientLies = { amountPiasters: 1, timestamp: Date.UTC(2100, 0, 1) };
  const saleById = async (id: string) =>
    (await f.salesOf(A)).find((s) => s.id === id)!;
  const expectServerTime = (d: Date) =>
    expect(Math.abs(d.getTime() - Date.now())).toBeLessThan(60_000);

  it("sandwich: the sandwich's price × count; the client amount and time are ignored", async () => {
    const bread = await f.product(A, { name: "عيش سعر", sell: 400 });
    await f.addStock(A, bread.variantId, 10);
    const sw = await call(sandwichRoute as never, A, "/api/sandwiches", {
      name: `ساندوتش سعر ${f.runId}`,
      sellPricePiasters: 1500,
      ingredients: [{ variantId: bread.variantId, quantity: 1, unit: "piece" }],
    });
    expect(sw.status).toBe(201);
    const swId = (sw.json.sandwich as { id: string }).id;
    const res = await f.request(A, "POST", {
      productId: swId,
      quantityBase: 2,
      opId: crypto.randomUUID(),
      ...clientLies,
    });
    expect(res.status).toBe(200);
    const sale = await saleById((res.json.data as { id: string }).id);
    expect(Number(sale.totalPiasters)).toBe(3000);
    const line = sale.saleLines[0]!;
    expect(Number(line.unitPricePiasters)).toBe(1500);
    expect(line.quantityBaseUnits).toBe(2);
    expect(Number(line.totalPiasters)).toBe(3000);
    expectServerTime(sale.createdAt);
  });

  it("offer: the saved offer price, split over its lines; the client amount and time are ignored", async () => {
    const chips = await f.product(A, { name: "شيبسي عرض", sell: 500 });
    const pepsi = await f.product(A, { name: "بيبسي عرض", sell: 1000 });
    await f.addStock(A, chips.variantId, 5);
    await f.addStock(A, pepsi.variantId, 5);
    const promoId = `promo-${crypto.randomUUID()}`;
    await f.as(A, (tx) =>
      tx.store.update({
        where: { id: A.storeId },
        data: {
          settings: {
            activePromotions: [
              {
                id: promoId,
                title: "كومبو سعر",
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
    const res = await f.request(A, "POST", {
      promotionId: promoId,
      opId: crypto.randomUUID(),
      ...clientLies,
    });
    expect(res.status).toBe(200);
    const sale = await saleById((res.json.data as { id: string }).id);
    expect(Number(sale.totalPiasters)).toBe(1500);
    expect(
      sale.saleLines.reduce((s, l) => s + Number(l.totalPiasters), 0),
    ).toBe(1500);
    expect(
      sale.saleLines
        .map((l) => [Number(l.unitPricePiasters), l.quantityBaseUnits])
        .sort(),
    ).toEqual(
      [
        [500, 2],
        [1000, 1],
      ].sort(),
    );
    expectServerTime(sale.createdAt);
  });

  it("service: the amount the customer paid (by design), one line, server time", async () => {
    const svc = await f.product(A, {
      name: "فاتورة سعر",
      sell: 0,
      category: "شحن رصيد",
    });
    const res = await f.sell(A, svc.variantId, 1, {
      amountPiasters: 2500,
      timestamp: Date.UTC(2100, 0, 1),
    });
    expect(res.status).toBe(200);
    const sale = await saleById((res.json.data as { id: string }).id);
    expect(Number(sale.totalPiasters)).toBe(2500);
    expect(sale.saleLines).toHaveLength(1);
    expect(Number(sale.saleLines[0]!.unitPricePiasters)).toBe(2500);
    expect(Number(sale.saleLines[0]!.totalPiasters)).toBe(2500);
    expectServerTime(sale.createdAt);
    // A service is sold one at a time: a quantity is a 400, not a multiplied amount.
    expect(
      (await f.sell(A, svc.variantId, 3, { amountPiasters: 2500 })).status,
    ).toBe(400);
  });
});
