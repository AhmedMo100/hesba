/**
 * ADR-0039 — the barcode stocktake and «فلوس حِسبة», against the real database (app role, RLS).
 *
 * - `GET /api/inventory-counts/:id/lines`: by barcode, by name (Arabic letters normalised), by
 *   state, a page at a time; a barcode of another section says where it is; damage recorded
 *   before is shown and never added to the difference; another shop sees nothing (404).
 * - `PATCH …?view=brief`: one line per product — the same total twice changes nothing and makes
 *   no second record; «سبب آخر» needs words (400, server side).
 * - Sections with their product counts (no services, no sandwiches).
 * - «اسأل حسبة»'s stocktake result: this shop's latest confirmed count only; read only.
 * - The drawer's cash is the shop's cash operations from zero (never typed by hand).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { GET as linesRoute } from "@/app/api/inventory-counts/[id]/lines/route";
import { PATCH as countRoute } from "@/app/api/inventory-counts/[id]/route";
import { GET as overviewRoute } from "@/app/api/inventory-counts/route";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import {
  confirmInventoryCount,
  getInventoryCountLines,
  lastStocktakeResultInTx,
  startInventoryCount,
} from "@/server/modules/inventory";
import { getMoneyOverview } from "@/server/modules/money";
import { BusinessToolsService } from "@/server/modules/ai/tools/business-tools";
import { SaleFixtures, type Shop } from "./helpers/sale-fixtures";

/** A JSON answer read loosely in the assertions. */
type Loose = Record<string, ReturnType<typeof JSON.parse>>;

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const op = () => crypto.randomUUID();
const tokens = new Map<string, string>();

async function cookieOf(shop: Shop | null) {
  if (!shop) return "";
  let token = tokens.get(shop.storeId);
  if (!token) {
    token = (await createSession(shop.userId, shop.storeId)).rawToken;
    tokens.set(shop.storeId, token);
  }
  return `hesba_session=${token}`;
}

async function lines(shop: Shop | null, id: string, qs: string) {
  const res = await linesRoute(
    new Request(
      `http://localhost:3000/api/inventory-counts/${id}/lines?${qs}`,
      {
        headers: { cookie: await cookieOf(shop) },
      },
    ),
    { params: Promise.resolve({ id }) },
  );
  return {
    status: res.status,
    json: (await res.json()) as Loose,
  };
}

async function patch(shop: Shop | null, id: string, body: unknown) {
  const res = await countRoute(
    new Request(`http://localhost:3000/api/inventory-counts/${id}?view=brief`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: await cookieOf(shop),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return {
    status: res.status,
    json: (await res.json()) as Loose,
  };
}

const setBarcode = (shop: Shop, variantId: string, barcode: string) =>
  f.as(shop, (tx) =>
    tx.storeVariant.update({ where: { id: variantId }, data: { barcode } }),
  );

let pepsi = "";
let water = "";
let rice = "";
let countId = "";

beforeAll(async () => {
  await f.setup();
  pepsi = (await f.product(A, { name: "بيبسي جرد", sell: 1500, buy: 1100 }))
    .variantId;
  water = (await f.product(A, { name: "مياه جرد", sell: 700, buy: 450 }))
    .variantId;
  rice = (
    await f.product(A, {
      name: "رز جرد",
      sell: 3800,
      buy: 3200,
      category: "بقالة",
    })
  ).variantId;
  // A service and a sandwich-free shop: services never become a section.
  await f.product(A, {
    name: "شحن جرد",
    sell: 0,
    unit: "service",
    category: "خدمات مرافق",
  });
  await setBarcode(A, pepsi, `622${f.runId}1`);
  await setBarcode(A, rice, `622${f.runId}9`);
  await f.addStock(A, pepsi, 20, { cost: 22000 });
  await f.addStock(A, water, 5, { cost: 2250 });
  await f.addStock(A, rice, 4, { cost: 12800 });
  // Damage recorded before the count: it already left the stock (20 → 18).
  const { InventoryService } = await import("@/server/modules/inventory");
  await new InventoryService(appPrisma).recordWaste(A.storeId, A.userId, {
    storeVariantId: pepsi,
    quantityBase: 2,
    reason: "broken_leak",
    source: "products",
  } as never);
  const c = await startInventoryCount(A.storeId, A.userId, {
    opId: op(),
    scope: "category",
    category: "مشروبات",
  });
  countId = c.id;
}, 120_000);

afterAll(async () => {
  // A closed count is frozen by a trigger: the count itself goes first (its lines cascade).
  const ids = [A.storeId, B.storeId];
  await f.sql`DELETE FROM inventory_counts WHERE store_id IN ${f.sql(ids)}`;
  await f.teardown();
});

describe("The sections", () => {
  it("each section with its products; no service section", async () => {
    const res = await overviewRoute(
      new Request("http://localhost:3000/api/inventory-counts", {
        headers: { cookie: await cookieOf(A) },
      }),
    );
    const j = (await res.json()) as {
      sections: Array<{ category: string; products: number }>;
    };
    expect(j.sections).toEqual(
      expect.arrayContaining([
        { category: "مشروبات", products: 2 },
        { category: "بقالة", products: 1 },
      ]),
    );
    expect(j.sections.some((s) => s.category === "خدمات مرافق")).toBe(false);
  });
});

describe("Finding a product in the count", () => {
  it("by barcode: the line, today's stock, and the damage recorded before (help only)", async () => {
    const r = await lines(A, countId, `barcode=622${f.runId}1`);
    expect(r.status).toBe(200);
    expect(r.json.lines).toHaveLength(1);
    const l = r.json.lines[0];
    expect(l.variantId).toBe(pepsi);
    expect(l.expectedBase).toBe(18);
    expect(l.wasteBefore.quantityBase).toBe(2);
    expect(l.wasteBefore.records[0].reasonLabel).toBe("كسر أو تسريب");
    expect(r.json).toMatchObject({ counted: 0, total: 2, elsewhere: null });
  });
  it("a barcode of another section says where it is; an unknown one finds nothing", async () => {
    const other = await lines(A, countId, `barcode=622${f.runId}9`);
    expect(other.json.lines).toHaveLength(0);
    expect(other.json.elsewhere).toEqual({
      name: `رز جرد ${f.runId}`,
      category: "بقالة",
    });
    const none = await lines(A, countId, "barcode=000000");
    expect(none.json).toMatchObject({ lines: [], elsewhere: null });
  });
  it("by name, with Arabic letters normalised (مياة finds مياه)", async () => {
    const r = await lines(A, countId, `q=${encodeURIComponent("مياة")}`);
    expect(r.json.lines.map((l: { variantId: string }) => l.variantId)).toEqual(
      [water],
    );
  });
  it("a page at a time, with the next cursor", async () => {
    const p1 = await lines(A, countId, "status=pending&limit=1");
    expect(p1.json.lines).toHaveLength(1);
    expect(p1.json.next).toBe(1);
    const p2 = await lines(A, countId, "status=pending&limit=1&cursor=1");
    expect(p2.json.lines).toHaveLength(1);
    expect(p2.json.next).toBeNull();
  });
  it("bad queries are refused (400)", async () => {
    expect((await lines(A, countId, "limit=500")).status).toBe(400);
    expect((await lines(A, countId, "status=everything")).status).toBe(400);
    expect((await lines(A, countId, "variantId=nope")).status).toBe(400);
  });
});

describe("Saving a count (brief)", () => {
  it("the same total twice: one line, no second record", async () => {
    const body = {
      lines: [{ variantId: pepsi, countedBase: 17, reason: "unrecorded_sale" }],
    };
    const a = await patch(A, countId, body);
    const b = await patch(A, countId, body);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.json.lines[0]).toMatchObject({
      countedBase: 17,
      differenceBase: -1,
      reason: "unrecorded_sale",
    });
    expect(b.json).toMatchObject({ counted: 1, total: 2 });
    const rows = await f.as(A, (tx) =>
      tx.inventoryCountLine.count({
        where: {
          storeId: A.storeId,
          sessionId: countId,
          storeVariantId: pepsi,
        },
      }),
    );
    expect(rows).toBe(1);
  });
  it("«سبب آخر» needs words (server side)", async () => {
    const bad = await patch(A, countId, {
      lines: [{ variantId: water, countedBase: 3, reason: "unknown" }],
    });
    expect(bad.status).toBe(400);
    const ok = await patch(A, countId, {
      lines: [
        {
          variantId: water,
          countedBase: 3,
          reason: "unknown",
          note: "اتشالت للعرض",
        },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.json.lines[0]).toMatchObject({
      reason: "unknown",
      note: "اتشالت للعرض",
    });
  });
  it("another shop can neither read nor write this count; anonymous is 401", async () => {
    expect((await lines(B, countId, "")).status).toBe(404);
    const w = await patch(B, countId, {
      lines: [{ variantId: pepsi, countedBase: 1 }],
    });
    expect(w.status).toBe(404);
    expect((await lines(null, countId, "")).status).toBe(401);
    const again = await getInventoryCountLines(A.storeId, A.userId, countId, {
      status: "all",
      cursor: 0,
      limit: 30,
      variantId: pepsi,
    });
    expect(again.lines[0]!.countedBase).toBe(17);
  });
});

describe("«اسأل حسبة» reads the latest confirmed count — this shop's only", () => {
  it("nothing before a confirmation; then the result with its chart; no change to stock", async () => {
    const before = await withTenant(A.storeId, A.userId, (tx) =>
      lastStocktakeResultInTx(tx, A.storeId),
    );
    expect(before).toBeNull();
    await confirmInventoryCount(A.storeId, A.userId, countId, op());
    const stockAfterConfirm = (await f.stockState(A, pepsi)).level;
    const tools = new BusinessToolsService(appPrisma);
    const r = (await tools.executeTool(
      "getStocktakeResult",
      {},
      {
        prisma: appPrisma,
        storeId: A.storeId,
        userId: A.userId,
      },
    )) as Loose;
    expect(r.found).toBe(true);
    expect(r).toMatchObject({
      counted_products: 2,
      shortage_products: 2,
      surplus_products: 0,
    });
    expect(r.chart.status).toEqual({ ok: 0, over: 0, short: 2 });
    expect(r.top_shortages.map((t: { reason: string }) => t.reason)).toEqual([
      "سبب آخر",
      "اتباع ومتسجلش",
    ]);
    // pos: 1 pepsi sold unrecorded at 15 ج
    expect(r.unrecorded_sales_value_piasters).toBe(1500);
    expect((await f.stockState(A, pepsi)).level).toBe(stockAfterConfirm);
    const other = (await tools.executeTool(
      "getStocktakeResult",
      {},
      {
        prisma: appPrisma,
        storeId: B.storeId,
        userId: B.userId,
      },
    )) as Loose;
    expect(other.found).toBe(false);
  });
});

describe("«فلوس الدرج» is computed, never typed", () => {
  it("a shop that never counted its drawer: cash in − cash out, from zero", async () => {
    const m = await getMoneyOverview(B.storeId, B.userId);
    const cash = m.accounts.find((a) => a.kind === "cash")!;
    expect(cash.balancePiasters).toBe(0);
    expect(m.cashKnown).toBe(true);
    const w = await f.product(B, { name: "سكر درج", sell: 3000, buy: 2000 });
    const { InventoryService } = await import("@/server/modules/inventory");
    await new InventoryService(appPrisma).addStockBatch(B.storeId, B.userId, {
      storeVariantId: w.variantId,
      receivedQuantityBase: 2,
      costTotalMinor: 4000,
      paidFrom: "cash",
    } as never);
    const after = await getMoneyOverview(B.storeId, B.userId);
    expect(after.accounts.find((a) => a.kind === "cash")!.balancePiasters).toBe(
      -4000,
    );
  });
});
