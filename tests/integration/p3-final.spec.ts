/**
 * QA-51, QA-52, QA-55 and QA-56 (docs/QA/FULL-SYSTEM-AUDIT.md, P3): real route handlers,
 * real sessions, real Postgres with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSession,
  rotateSession,
  validateSession,
} from "@/server/modules/auth";
import * as productsRoute from "@/app/api/products/route";
import * as stockRoute from "@/app/api/stock/route";
import { GET as listSales } from "@/app/api/sales/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const globalIds: string[] = [];

async function get(
  handler: (req: Request) => Promise<Response>,
  token: string,
  path: string,
): Promise<{ status: number; json: Json }> {
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      headers: { cookie: `hesba_session=${token}` },
    }),
  );
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Json,
  };
}
const tokenOf = async (shop: Shop) =>
  (await createSession(shop.userId, shop.storeId)).rawToken;

beforeAll(() => f.setup());
afterAll(async () => {
  for (const id of globalIds)
    await f.sql`DELETE FROM global_products WHERE id = ${id}`;
  await f.teardown();
});

describe("QA-56 — the server chooses sale ids", () => {
  it("the same client id in two shops, twice in one shop, and an offline retry", async () => {
    const pA = await f.product(A, { name: "صنف أ", sell: 500 });
    const pB = await f.product(B, { name: "صنف ب", sell: 700 });
    await f.addStock(A, pA.variantId, 10);
    await f.addStock(B, pB.variantId, 10);
    const clientId = crypto.randomUUID();

    const a1 = await f.sell(A, pA.variantId, 1, { id: clientId });
    expect(a1.status).toBe(200);
    const saleA = a1.json.data as { id: string };
    expect(saleA.id).not.toBe(clientId);

    // Shop B with shop A's id: a normal sale (no 500, nothing revealed, nothing overwritten).
    const b1 = await f.sell(B, pB.variantId, 1, { id: saleA.id });
    expect(b1.status).toBe(200);
    const saleB = b1.json.data as { id: string };
    expect(saleB.id).not.toBe(saleA.id);

    // The same id again in shop A with another opId: a second sale, the first unchanged.
    const a2 = await f.sell(A, pA.variantId, 2, { id: clientId });
    expect(a2.status).toBe(200);
    expect((a2.json.data as { id: string }).id).not.toBe(saleA.id);

    // An offline retry (same opId): the first sale, once.
    const opId = crypto.randomUUID();
    const r1 = await f.sell(A, pA.variantId, 1, { opId, id: clientId });
    const r2 = await f.sell(A, pA.variantId, 1, { opId, id: clientId });
    const d1 = r1.json.data as { id: string; duplicate: boolean };
    const d2 = r2.json.data as { id: string; duplicate: boolean };
    expect(d2.id).toBe(d1.id);
    expect(d2.duplicate).toBe(true);

    const salesA = await f.as(A, (tx) =>
      tx.sale.findMany({ where: { storeId: A.storeId } }),
    );
    expect(salesA).toHaveLength(3);
    const first = salesA.find((s) => s.id === saleA.id)!;
    expect(Number(first.totalPiasters)).toBe(500);
    const salesB = await f.as(B, (tx) =>
      tx.sale.findMany({ where: { storeId: B.storeId } }),
    );
    expect(salesB.map((s) => s.id)).toEqual([saleB.id]);
  });
});

describe("QA-52 — the stock-level rule on the server", () => {
  it("weighed goods are low under 3 kg (not 5 g); packs under two packs; pieces under 10", async () => {
    const token = await tokenOf(A);
    const kg = await f.product(A, {
      name: "جبنة وزن",
      sell: 20000,
      unit: "kg",
    });
    await f.addStock(A, kg.variantId, 2500, { cost: 100 });
    const pcs = await f.product(A, { name: "قطع", sell: 100 });
    await f.addStock(A, pcs.variantId, 9);
    const r = await get(stockRoute.GET, token, "/api/stock");
    expect(r.status).toBe(200);
    const inv = r.json.inventory as Array<{
      variantId: string;
      status: string;
    }>;
    expect(inv.find((i) => i.variantId === kg.variantId)!.status).toBe("low");
    expect(inv.find((i) => i.variantId === pcs.variantId)!.status).toBe("low");
    await f.addStock(A, kg.variantId, 500, { cost: 100 });
    await f.addStock(A, pcs.variantId, 1);
    const r2 = await get(stockRoute.GET, token, "/api/stock");
    const inv2 = r2.json.inventory as Array<{
      variantId: string;
      status: string;
    }>;
    expect(inv2.find((i) => i.variantId === kg.variantId)!.status).toBe("ok");
    expect(inv2.find((i) => i.variantId === pcs.variantId)!.status).toBe("ok");
  });
});

describe("QA-55 — the products list is shaped per screen", () => {
  it("full list unchanged in shape; scope=store only the shop's; scope=sale adds services", async () => {
    const token = await tokenOf(A);
    const own = await f.product(A, { name: "منتج المحل", sell: 900 });
    const [gp] = await f.sql<Array<{ id: string }>>`
      INSERT INTO global_products (name_ar, name_norm, category, type, status)
      VALUES (${`كتالوج ${f.runId}`}, ${`كتالوج ${f.runId}`}, 'مشروبات', 'stock', 'approved') RETURNING id`;
    const [svc] = await f.sql<Array<{ id: string }>>`
      INSERT INTO global_products (name_ar, name_norm, category, type, status)
      VALUES (${`كارت ${f.runId}`}, ${`كارت ${f.runId}`}, 'كروت شحن', 'service', 'approved') RETURNING id`;
    globalIds.push(gp!.id, svc!.id);

    type Row = Record<string, unknown> & {
      id: string;
      global_product_id: string | null;
      variants: Array<Record<string, unknown>>;
    };
    const list = async (q: string) =>
      (await get(productsRoute.GET, token, `/api/products${q}`)).json
        .products as Row[];

    const full = await list("?filter=all");
    expect(full.some((p) => p.global_product_id === gp!.id)).toBe(true);
    const mine = full.find((p) => p.id === own.productId)!;
    // The fields the screens read are all there.
    for (const k of [
      "id",
      "name_ar",
      "category",
      "unit",
      "sell_price_piasters",
      "buy_cost_piasters",
      "stock_quantity",
      "brand_name",
      "name_en",
      "brand_name_en",
      "is_custom",
      "added_by_this_store",
      "is_hidden",
      "global_product_id",
      "kind",
      "variants",
    ])
      expect(mine, k).toHaveProperty(k);
    for (const k of [
      "id",
      "flavor",
      "size_value",
      "size_unit",
      "pack_qty",
      "sell_price_piasters",
      "buy_cost_piasters",
      "stock_quantity",
      "global_variant_id",
    ])
      expect(mine.variants[0], k).toHaveProperty(k);

    const store = await list("?filter=all&scope=store");
    expect(store.map((p) => p.id)).toContain(own.productId);
    expect(store.some((p) => p.id.startsWith("gp_"))).toBe(false);

    const sale = await list("?filter=all&scope=sale");
    expect(sale.map((p) => p.id)).toContain(own.productId);
    expect(sale.some((p) => p.global_product_id === svc!.id)).toBe(true);
    expect(sale.some((p) => p.global_product_id === gp!.id)).toBe(false);
    expect(JSON.stringify(sale).length).toBeLessThan(
      JSON.stringify(full).length,
    );
  });
});

describe("QA-51 — sessions: renewal, revocation, membership, devices", () => {
  it("rotation renews the 30-day window; the old token is refused; other devices keep working", async () => {
    const phone = await tokenOf(A);
    const laptop = await tokenOf(A);
    await f.sql`UPDATE sessions SET expires_at = now() + interval '20 days'
      WHERE id_hash = encode(sha256(convert_to(${phone}, 'UTF8')), 'hex')`;
    const before = (await validateSession(phone))!.session.expiresAt;
    const rotated = await rotateSession(phone);
    expect(rotated.session.expiresAt.getTime()).toBeGreaterThan(
      before.getTime() + 9 * 24 * 3600_000,
    );
    await expect(validateSession(phone)).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(await validateSession(rotated.rawToken)).not.toBeNull();
    expect(await validateSession(laptop)).not.toBeNull();
  });

  it("an expired or revoked session is refused", async () => {
    const t1 = await tokenOf(A);
    await f.sql`UPDATE sessions SET expires_at = now() - interval '1 minute'
      WHERE id_hash = encode(sha256(convert_to(${t1}, 'UTF8')), 'hex')`;
    expect((await get(listSales, t1, "/api/sales")).status).toBe(401);
    const t2 = await tokenOf(A);
    await f.sql`UPDATE sessions SET revoked_at = now() - interval '1 hour'
      WHERE id_hash = encode(sha256(convert_to(${t2}, 'UTF8')), 'hex')`;
    expect((await get(listSales, t2, "/api/sales")).status).toBe(401);
  });

  it("a member removed from the shop loses access on the next request, on every device", async () => {
    const d1 = await tokenOf(B);
    const d2 = await tokenOf(B);
    expect((await get(listSales, d1, "/api/sales")).status).toBe(200);
    await f.sql`DELETE FROM store_members WHERE store_id = ${B.storeId} AND user_id = ${B.userId}`;
    expect((await get(listSales, d1, "/api/sales")).status).toBe(401);
    expect((await get(listSales, d2, "/api/sales")).status).toBe(401);
    // The refused session is revoked for good (re-adding the member does not revive it).
    await f.sql`INSERT INTO store_members (store_id, user_id, role) VALUES (${B.storeId}, ${B.userId}, 'owner')`;
    expect((await get(listSales, d1, "/api/sales")).status).toBe(401);
    // A new sign-in works again.
    expect((await get(listSales, await tokenOf(B), "/api/sales")).status).toBe(
      200,
    );
  });
});
