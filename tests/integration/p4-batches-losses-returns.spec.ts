/**
 * P4 (batches, expiry, losses, returns) on real Postgres through the real route handlers
 * (app role, FORCE RLS): separate batches per expiry, FEFO over sellable batches only, expired
 * goods never sold, batch-level expiry alerts, damaged / lost goods with their cost on Home,
 * and returns tied to the invoice — sellable or damaged, partial, repeated, by unit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import { GET as alertsRoute } from "@/app/api/alerts/route";
import { GET as homeRoute } from "@/app/api/reports/home/route";
import { POST as stockRoute } from "@/app/api/stock/route";
import { addDaysToDateKey, toCairoDateString } from "@/domain/time";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const today = toCairoDateString(new Date());
const inDays = (n: number) => addDaysToDateKey(today, n);
const tokens = new Map<string, string>();

async function call(
  shop: Shop,
  handler: (req: Request, ctx: never) => Promise<Response>,
  path: string,
  body?: unknown,
  ctx?: unknown,
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
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: `hesba_session=${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ctx as never,
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const batchesOf = async (_shop: Shop, variantId: string) =>
  (
    await f.sql<
      Array<{
        id: string;
        expiry: string | null;
        received: number;
        left: number;
      }>
    >`SELECT id::text AS id, to_char(expiry_date, 'YYYY-MM-DD') AS expiry,
             received_quantity_base::int AS received,
             remaining_quantity_base::int AS left
        FROM store_stock_batches WHERE store_variant_id = ${variantId}::uuid
       ORDER BY expiry_date ASC NULLS LAST, received_at ASC`
  ).map((r) => ({ ...r }));
const levelOf = async (shop: Shop, variantId: string) =>
  (await f.stockState(shop, variantId)).level;

/** Marks a batch as expired (yesterday, Cairo) — the API refuses past expiry dates. */
const expire = (batchId: string, days = 1) =>
  f.sql`UPDATE store_stock_batches SET expiry_date = ${inDays(-days)}::date WHERE id = ${batchId}::uuid`;

const checkout = (
  shop: Shop,
  lines: Array<{ variantId: string; quantityBase: number }>,
  extra: Json = {},
) =>
  call(shop, checkoutRoute as never, "/api/sales/checkout", {
    opId: crypto.randomUUID(),
    lines,
    discountPiasters: 0,
    paymentMethod: "cash",
    paidNowPiasters: 0,
    ...extra,
  });

const returnLines = (
  shop: Shop,
  saleId: string,
  lines: Array<{
    saleLineId: string;
    quantityBase: number;
    condition?: string;
  }>,
  opId: string = crypto.randomUUID(),
) =>
  call(
    shop,
    returnRoute as never,
    `/api/sales/${saleId}/returns`,
    { opId, lines },
    { params: Promise.resolve({ id: saleId }) },
  );

beforeAll(() => f.setup());
afterAll(async () => {
  await f.sql`DELETE FROM waste_records WHERE store_id IN ${f.sql([A.storeId, B.storeId])}`;
  await f.sql`DELETE FROM sale_returns WHERE store_id IN ${f.sql([A.storeId, B.storeId])}`;
  await f.teardown();
});

describe("stock batches and FEFO", () => {
  it("two deliveries with different expiry stay separate; total is their sum", async () => {
    const milk = await f.product(A, { name: "لبن", sell: 1500 });
    await f.addStock(A, milk.variantId, 20, { expiry: inDays(8) });
    await f.addStock(A, milk.variantId, 30, { expiry: inDays(33) });
    const bs = await batchesOf(A, milk.variantId);
    expect(bs.map((b) => [b.expiry, b.left])).toEqual([
      [inDays(8), 20],
      [inDays(33), 30],
    ]);
    expect(await levelOf(A, milk.variantId)).toBe(50);

    // FEFO: 25 sold → the earliest batch empties, 5 from the next one.
    const r = await f.sell(A, milk.variantId, 25);
    expect(r.status).toBe(200);
    const after = await batchesOf(A, milk.variantId);
    expect(after.map((b) => b.left)).toEqual([0, 25]);
    // Exactly which batches the sale took, and how much.
    const takes = (await f.stockState(A, milk.variantId)).movements
      .filter((m) => m.type === "sale")
      .map((m) => [m.batchId, -m.quantity]);
    expect(takes).toEqual([
      [bs[0]!.id, 20],
      [bs[1]!.id, 5],
    ]);

    // Never negative: more than is left is refused, nothing changes.
    const over = await f.sell(A, milk.variantId, 26);
    expect(over.status).toBe(409);
    expect(await levelOf(A, milk.variantId)).toBe(25);
  });

  it("expired goods are never sold: FEFO skips them, and they do not count as available", async () => {
    const yog = await f.product(A, { name: "زبادي", sell: 800 });
    const old = await f.addStock(A, yog.variantId, 4, { expiry: inDays(2) });
    await f.addStock(A, yog.variantId, 6, { expiry: inDays(20) });
    await expire(old.batchId!);

    // 7 > 6 sellable (the 4 expired do not count), even though the ledger says 10.
    const tooMany = await f.sell(A, yog.variantId, 7);
    expect(tooMany.status).toBe(409);
    const ok = await f.sell(A, yog.variantId, 6);
    expect(ok.status).toBe(200);
    const bs = await batchesOf(A, yog.variantId);
    expect(bs.map((b) => [b.expiry, b.left])).toEqual([
      [inDays(-1), 4], // the expired batch is untouched
      [inDays(20), 0],
    ]);
    // Only expired stock left: a sale is refused (also through the cart checkout).
    expect((await f.sell(A, yog.variantId, 1)).status).toBe(409);
    expect(
      (await checkout(A, [{ variantId: yog.variantId, quantityBase: 1 }]))
        .status,
    ).toBe(409);
  });
});

describe("expiry alerts are per batch", () => {
  it("only the near batch's quantity is flagged; it shrinks with a sale and goes away when empty", async () => {
    const cheese = await f.product(A, { name: "جبنة", sell: 3000 });
    const near = await f.addStock(A, cheese.variantId, 20, {
      expiry: inDays(3),
    });
    await f.addStock(A, cheese.variantId, 30, { expiry: inDays(60) });

    const alertsFor = async () => {
      const r = await call(A, alertsRoute as never, "/api/alerts");
      expect(r.status).toBe(200);
      return (
        r.json.nearExpiry as Array<{
          batchId: string;
          variantId: string;
          remainingQtyBase: number;
        }>
      ).filter((a) => a.variantId === cheese.variantId);
    };
    expect(await alertsFor()).toEqual([
      expect.objectContaining({ batchId: near.batchId, remainingQtyBase: 20 }),
    ]);
    await f.sell(A, cheese.variantId, 5); // FEFO: from the near batch
    expect((await alertsFor()).map((a) => a.remainingQtyBase)).toEqual([15]);
    await f.sell(A, cheese.variantId, 15);
    expect(await alertsFor()).toEqual([]); // empty batch: resolved, the 30 never flagged
  });
});

describe("damaged / lost goods", () => {
  it("expired, damaged and missing reduce the batch and stock, cost from the batch, shown on Home", async () => {
    const before = await call(
      A,
      homeRoute as never,
      "/api/reports/home?period=today",
    );
    const baseCount = (before.json.losses as { count: number }).count;
    const baseCost = (before.json.losses as { costPiasters: number })
      .costPiasters;

    const oil = await f.product(A, { name: "زيت", sell: 9000 });
    // 10 bottles for 600.00 → 60.00 each.
    const b1 = await f.addStock(A, oil.variantId, 10, {
      expiry: inDays(5),
      cost: 60000,
    });
    await expire(b1.batchId!);
    const waste = (body: Json) =>
      call(A, stockRoute as never, "/api/stock", {
        action: "waste",
        storeVariantId: oil.variantId,
        opId: crypto.randomUUID(),
        ...body,
      });
    expect(
      (await waste({ batchId: b1.batchId, quantityBase: 2, reason: "expired" }))
        .status,
    ).toBe(200);
    expect(
      (
        await waste({
          quantityBase: 3,
          reason: "damaged",
          note: "اتكسرت في النقل",
        })
      ).status,
    ).toBe(200);
    expect((await waste({ quantityBase: 1, reason: "missing" })).status).toBe(
      200,
    );
    // An unknown reason is refused.
    expect((await waste({ quantityBase: 1, reason: "stolen?" })).status).toBe(
      400,
    );

    expect(await levelOf(A, oil.variantId)).toBe(4);
    expect((await batchesOf(A, oil.variantId))[0]!.left).toBe(4);

    const home = await call(
      A,
      homeRoute as never,
      "/api/reports/home?period=today",
    );
    const losses = home.json.losses as {
      count: number;
      costPiasters: number;
      byReason: Array<{ reason: string; count: number; costPiasters: number }>;
      recent: Array<{
        reason: string;
        note: string | null;
        quantityBase: number;
      }>;
    };
    expect(losses.count - baseCount).toBe(3);
    expect(losses.costPiasters - baseCost).toBe(6 * 6000); // 6 bottles × 60.00, counted once
    const damaged = losses.recent.find((r) => r.reason === "damaged")!;
    expect(damaged).toMatchObject({ note: "اتكسرت في النقل", quantityBase: 3 });
  });
});

describe("returns", () => {
  it("partial, repeated, sellable and damaged returns; never more than sold; refund once", async () => {
    const tea = await f.product(A, { name: "شاي", sell: 1000 });
    const early = await f.addStock(A, tea.variantId, 10, {
      expiry: inDays(10),
    });
    const late = await f.addStock(A, tea.variantId, 10, { expiry: inDays(40) });
    const sale = await checkout(A, [
      { variantId: tea.variantId, quantityBase: 15 },
    ]);
    expect(sale.status).toBe(201);
    const inv = sale.json.invoice as {
      id: string;
      lines: Array<{ id: string }>;
    };
    const lineId = inv.lines[0]!.id;
    expect(await levelOf(A, tea.variantId)).toBe(5);

    // 1. Partial sellable return of 3 → back to the batch the sale took last (the later one).
    const opId = crypto.randomUUID();
    const r1 = await returnLines(
      A,
      inv.id,
      [{ saleLineId: lineId, quantityBase: 3 }],
      opId,
    );
    expect(r1.status).toBe(201);
    expect(await levelOf(A, tea.variantId)).toBe(8);
    let bs = await batchesOf(A, tea.variantId);
    expect(bs.find((b) => b.id === late.batchId)!.left).toBe(8);
    // Same opId again: the same return, not a second refund.
    const again = await returnLines(
      A,
      inv.id,
      [{ saleLineId: lineId, quantityBase: 3 }],
      opId,
    );
    expect(again.status).toBe(200); // a replay: the recorded return, not a new one
    expect(await levelOf(A, tea.variantId)).toBe(8);
    const refunds = await f.sql<Array<{ n: number; total: string }>>`
      SELECT count(*)::int AS n, sum(refunded_piasters)::text AS total
        FROM sale_returns WHERE sale_id = ${inv.id}::uuid`;
    expect(refunds[0]).toEqual({ n: 1, total: "3000" });

    // 2. Damaged return of 2: credited/refunded, recorded as a loss, stock does not grow.
    const r2 = await returnLines(A, inv.id, [
      { saleLineId: lineId, quantityBase: 2, condition: "damaged" },
    ]);
    expect(r2.status).toBe(201);
    expect(await levelOf(A, tea.variantId)).toBe(8);
    const w = await f.sql<
      Array<{ reason: string; qty: string; ret: string | null }>
    >`
      SELECT reason, quantity_base::text AS qty, sale_return_id::text AS ret
        FROM waste_records WHERE store_variant_id = ${tea.variantId}::uuid`;
    expect(w).toEqual([
      { reason: "damaged_return", qty: "2", ret: expect.any(String) },
    ]);

    // 3. More than what is left to return (15 − 5 = 10) is refused; exactly 10 works.
    const over = await returnLines(A, inv.id, [
      { saleLineId: lineId, quantityBase: 11 },
    ]);
    expect(over.status).toBe(400);
    const rest = await returnLines(A, inv.id, [
      { saleLineId: lineId, quantityBase: 10 },
    ]);
    expect(rest.status).toBe(201);
    expect(await levelOf(A, tea.variantId)).toBe(18);
    bs = await batchesOf(A, tea.variantId);
    // Restored into the original batches, never beyond what each received; expiry unchanged.
    expect(bs.map((b) => [b.expiry, b.left])).toEqual([
      [inDays(10), 10],
      [inDays(40), 8],
    ]);
    expect(bs.find((b) => b.id === early.batchId)!.received).toBe(10);
    const total = await f.sql<Array<{ s: string }>>`
      SELECT sum(amount_piasters)::text AS s FROM sale_returns WHERE sale_id = ${inv.id}::uuid`;
    expect(total[0]!.s).toBe("15000"); // the whole invoice, refunded once in parts
  });

  it("weighed goods return in grams (0.5 kg) and packed goods in pieces of a carton", async () => {
    const rice = await f.product(A, { name: "رز", sell: 4000, unit: "kg" });
    await f.addStock(A, rice.variantId, 5000, { expiry: inDays(90) });
    const pasta = await f.product(A, {
      name: "مكرونة",
      sell: 1200,
      unit: "bag",
    });
    await f.sql`UPDATE store_variants SET pack_qty = 20 WHERE id = ${pasta.variantId}::uuid`;
    await f.addStock(A, pasta.variantId, 40, { expiry: inDays(90) });

    const sale = await checkout(A, [
      { variantId: rice.variantId, quantityBase: 2000 }, // 2 kg
      { variantId: pasta.variantId, quantityBase: 20 }, // 1 carton of 20 bags
    ]);
    expect(sale.status).toBe(201);
    const lines = sale.json.invoice as {
      id: string;
      lines: Array<{ id: string; variantId: string; totalPiasters: number }>;
    };
    const riceLine = lines.lines.find((l) => l.variantId === rice.variantId)!;
    const pastaLine = lines.lines.find((l) => l.variantId === pasta.variantId)!;
    expect(riceLine.totalPiasters).toBe(8000);

    const r = await returnLines(A, lines.id, [
      { saleLineId: riceLine.id, quantityBase: 500 },
      { saleLineId: pastaLine.id, quantityBase: 3 },
    ]);
    expect(r.status).toBe(201);
    expect(await levelOf(A, rice.variantId)).toBe(3500);
    expect(await levelOf(A, pasta.variantId)).toBe(23);
    const ret = await f.sql<Array<{ amount: string }>>`
      SELECT amount_piasters::text AS amount FROM sale_returns WHERE sale_id = ${lines.id}::uuid`;
    expect(ret[0]!.amount).toBe(String(2000 + 3 * 1200)); // 0.5 kg × 40.00 + 3 bags × 12.00
  });

  it("another shop can neither return nor see this shop's sale or batches", async () => {
    const soap = await f.product(A, { name: "صابون", sell: 500 });
    await f.addStock(A, soap.variantId, 5, { expiry: inDays(100) });
    const sale = await checkout(A, [
      { variantId: soap.variantId, quantityBase: 2 },
    ]);
    const inv = sale.json.invoice as {
      id: string;
      lines: Array<{ id: string }>;
    };
    const r = await returnLines(B, inv.id, [
      { saleLineId: inv.lines[0]!.id, quantityBase: 1 },
    ]);
    expect(r.status).toBe(404);
    const waste = await call(B, stockRoute as never, "/api/stock", {
      action: "waste",
      storeVariantId: soap.variantId,
      quantityBase: 1,
      reason: "missing",
    });
    expect(waste.status).toBe(404);
    expect(await levelOf(A, soap.variantId)).toBe(3);
  });
});
