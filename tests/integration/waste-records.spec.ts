/**
 * ADR-0037 — «التالف» as one recorded operation (real Postgres, the app role, the real route):
 * - from «بضاعتي» or «التنبيهات»: the stock goes down at once, by the product's own unit (piece,
 *   carton = packs + units, weight in grams); the record keeps who, from where, the product's
 *   name and the quantity as read then, and the cost of what was taken from the batches;
 * - never more than the stock (409, nothing changes); the same opId twice is recorded once;
 * - «سبب آخر» needs its description; an unknown reason is a 400;
 * - no sale, no revenue: the report shows the loss at cost and the same sales as before;
 * - the log (`GET /api/stock?view=waste`) lists it with its reason, source and who; another shop
 *   sees nothing and cannot record on this shop's product; the app cannot delete the history.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import * as stockRoute from "@/app/api/stock/route";
import { GET as reportHome } from "@/app/api/reports/home/route";
import { SaleFixtures, type Shop } from "./helpers/sale-fixtures";

/** The route answers this test reads (a loose JSON shape, checked by the assertions). */
type Answer = {
  data: { wasteId: string; duplicate: boolean };
  sales: { revenuePiasters: number };
  losses: { costPiasters: number };
  waste: WasteRow[];
};
type WasteRow = {
  reason: string;
  quantityText: string;
  source: string | null;
  costPiasters: number;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
};

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const tokens = new Map<string, string>();
const op = () => crypto.randomUUID();

async function cookie(shop: Shop) {
  let t = tokens.get(shop.storeId);
  if (!t) {
    t = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, t);
  }
  return `hesba_session=${t}`;
}

async function waste(shop: Shop, body: Record<string, unknown>) {
  const res = await stockRoute.POST(
    new Request("http://localhost:3000/api/stock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: await cookie(shop),
      },
      body: JSON.stringify({ action: "waste", ...body }),
    }),
  );
  return {
    status: res.status,
    json: (await res.json()) as Answer,
  };
}

async function get(
  handler: (req: Request) => Promise<Response>,
  shop: Shop,
  path: string,
) {
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      headers: { cookie: await cookie(shop) },
    }),
  );
  return {
    status: res.status,
    json: (await res.json()) as Answer,
  };
}

let piece = "";
let carton = "";
let weighed = "";

beforeAll(async () => {
  await f.setup();
  piece = (await f.product(A, { name: "زيت تالف", sell: 6000, buy: 5000 }))
    .variantId;
  await f.addStock(A, piece, 10, { cost: 50000 }); // 50 ج each
  // A carton of 24 (the product's pack): 1 carton + 2 pieces = 26.
  const c = await f.product(A, { name: "عصير كرتونة", sell: 1500, buy: 1000 });
  carton = c.variantId;
  await f.as(A, (tx) =>
    tx.storeVariant.update({
      where: { id: carton },
      data: { packQty: 24, sizeUnit: "carton" },
    }),
  );
  await f.addStock(A, carton, 48, { cost: 48000 }); // 10 ج each
  // Weighed goods (grams): 5 kg.
  weighed = (
    await f.product(A, {
      name: "جبنة وزن",
      unit: "kg",
      sell: 20000,
      buy: 15000,
    })
  ).variantId;
  await f.addStock(A, weighed, 5000, { cost: 75000 }); // 150 ج / kg
});

afterAll(async () => {
  await f.teardown();
});

describe("recording damaged goods", () => {
  it("a piece, from «بضاعتي»: stock down, who / where / name / quantity / cost recorded", async () => {
    const r = await waste(A, {
      storeVariantId: piece,
      quantityBase: 3,
      reason: "broken_leak",
      note: "الإزازة وقعت",
      source: "products",
      opId: op(),
    });
    expect(r.status).toBe(200);
    expect((await f.stockState(A, piece)).level).toBe(7);
    const [row] = await f.sql<
      Array<Record<string, unknown>>
    >`SELECT reason, note, source, created_by, product_name, quantity_text, cost_minor, quantity_base
        FROM waste_records WHERE id = ${r.json.data.wasteId}`;
    expect(row).toMatchObject({
      reason: "broken_leak",
      note: "الإزازة وقعت",
      source: "products",
      created_by: A.userId,
      quantity_text: "3 قطعة",
    });
    expect(row!.product_name).toContain("زيت تالف");
    expect(Number(row!.cost_minor)).toBe(15000); // 3 × 50 ج, from the batch
  });

  it("a carton (packs + units) and weighed goods (grams), from «التنبيهات»", async () => {
    const c = await waste(A, {
      storeVariantId: carton,
      quantityBase: 26,
      reason: "supplier_damage",
      source: "alerts",
      opId: op(),
    });
    expect(c.status).toBe(200);
    expect((await f.stockState(A, carton)).level).toBe(22);
    const w = await waste(A, {
      storeVariantId: weighed,
      quantityBase: 1500,
      reason: "near_expiry",
      source: "alerts",
      opId: op(),
    });
    expect(w.status).toBe(200);
    expect((await f.stockState(A, weighed)).level).toBe(3500);
    const rows = await f.sql<
      Array<{ quantity_text: string; cost_minor: bigint; source: string }>
    >`SELECT quantity_text, cost_minor, source FROM waste_records
        WHERE id IN (${c.json.data.wasteId}, ${w.json.data.wasteId}) ORDER BY quantity_base`;
    expect(rows.map((x) => x.quantity_text).sort()).toEqual(
      ["1 كرتونة + 2 قطعة", "1.5 كجم"].sort(),
    );
    expect(rows.every((x) => x.source === "alerts")).toBe(true);
    const costs = rows.map((x) => Number(x.cost_minor)).sort((a, b) => a - b);
    expect(costs).toEqual([22500, 26000]); // 1.5 kg × 150 ج · 26 × 10 ج
  });

  it("never more than the stock: 409 and nothing changes", async () => {
    const before = await f.stockState(A, piece);
    const r = await waste(A, {
      storeVariantId: piece,
      quantityBase: before.level + 1,
      reason: "storage_damage",
      source: "products",
      opId: op(),
    });
    expect(r.status).toBe(409);
    expect(await f.stockState(A, piece)).toEqual(before);
  });

  it("the same operation sent twice is recorded once", async () => {
    const id = op();
    const body = {
      storeVariantId: piece,
      quantityBase: 1,
      reason: "poor_storage",
      source: "products",
      opId: id,
    };
    const first = await waste(A, body);
    const again = await waste(A, body);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.json.data.duplicate).toBe(true);
    const [counted] = await f.sql<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM stock_movements WHERE store_id = ${A.storeId} AND op_id = ${id}`;
    expect(counted?.n).toBe(1);
    expect((await f.stockState(A, piece)).level).toBe(6);
  });

  it("«سبب آخر» needs a description; an unknown reason is refused", async () => {
    const bare = await waste(A, {
      storeVariantId: piece,
      quantityBase: 1,
      reason: "other",
      opId: op(),
    });
    expect(bare.status).toBe(400);
    expect(JSON.stringify(bare.json)).toContain("اكتب سبب التلف");
    const unknown = await waste(A, {
      storeVariantId: piece,
      quantityBase: 1,
      reason: "stolen-by-aliens",
      opId: op(),
    });
    expect(unknown.status).toBe(400);
    expect((await f.stockState(A, piece)).level).toBe(6);
    const ok = await waste(A, {
      storeVariantId: piece,
      quantityBase: 1,
      reason: "other",
      note: "الفار أكلها",
      source: "products",
      opId: op(),
    });
    expect(ok.status).toBe(200);
    expect((await f.stockState(A, piece)).level).toBe(5);
  });

  it("no sale, no revenue: the report shows the loss at cost", async () => {
    const sales = await f.salesOf(A);
    expect(sales).toHaveLength(0);
    const r = await get(reportHome, A, "/api/reports/home?period=today");
    expect(r.status).toBe(200);
    expect(r.json.sales.revenuePiasters).toBe(0);
    // 3 + 1 + 1 pieces × 50 ج, 26 × 10 ج, 1.5 kg × 150 ج
    expect(r.json.losses.costPiasters).toBe(25000 + 26000 + 22500);
  });

  it("the log lists every record with its reason, source and who; another shop sees nothing", async () => {
    const mine = await get(stockRoute.GET, A, "/api/stock?view=waste");
    expect(mine.status).toBe(200);
    const list = mine.json.waste;
    expect(list).toHaveLength(5);
    const leak = list.find((w) => w.reason === "broken_leak")!;
    expect(leak).toMatchObject({
      quantityText: "3 قطعة",
      source: "products",
      costPiasters: 15000,
      note: "الإزازة وقعت",
    });
    expect(leak.createdByName).toBeTruthy();
    // Newest first.
    const times = list.map((w) => Date.parse(w.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const theirs = await get(stockRoute.GET, B, "/api/stock?view=waste");
    expect(theirs.json.waste).toEqual([]);
    // Another shop cannot record damage on this shop's product.
    const cross = await waste(B, {
      storeVariantId: piece,
      quantityBase: 1,
      reason: "storage_damage",
      opId: op(),
    });
    expect(cross.status).toBe(404);
    expect((await f.stockState(A, piece)).level).toBe(5);
  });

  it("the history stays: the app role cannot delete or rewrite a record", async () => {
    const asApp = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
      withTenant(A.storeId, A.userId, fn, appPrisma);
    await expect(
      asApp((tx) =>
        tx.wasteRecord.deleteMany({ where: { storeId: A.storeId } }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp((tx) =>
        tx.wasteRecord.updateMany({
          where: { storeId: A.storeId },
          data: { reason: "expired" },
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    const [counted] = await f.sql<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM waste_records WHERE store_id = ${A.storeId}`;
    expect(counted?.n).toBe(5);
  });
});
