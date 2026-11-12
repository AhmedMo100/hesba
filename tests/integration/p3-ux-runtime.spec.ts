/**
 * QA-48 and QA-50 (docs/QA/FULL-SYSTEM-AUDIT.md, P3): real route handlers, real sessions, real
 * Postgres with RLS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import * as products from "@/app/api/products/route";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

type Handler = (req: Request, ctx: never) => Promise<Response>;
const f = new SaleFixtures();
const A = f.shopA;
const tokens = new Map<string, string>();
const signedUp: string[] = [];
const globalIds: string[] = [];
const brandIds: string[] = [];

async function call(
  handler: Handler,
  shop: Shop | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (shop) {
    let token = tokens.get(shop.storeId);
    if (!token) {
      token = (await createSession(shop.userId, shop.storeId)).rawToken;
      tokens.set(shop.storeId, token);
    }
    headers["cookie"] = `hesba_session=${token}`;
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) } as never,
  );
  return {
    status: res.status,
    json: (await res.json().catch(() => ({}))) as Json,
  };
}

beforeAll(() => f.setup());
afterAll(async () => {
  await f.sql`DROP TRIGGER IF EXISTS qa50_fail_device ON devices`;
  await f.sql`DROP FUNCTION IF EXISTS qa50_fail_device()`;
  for (const email of signedUp) {
    const users = await f.sql<
      Array<{ id: string }>
    >`SELECT id FROM users WHERE email = ${email}`;
    for (const { id } of users) {
      const stores = await f.sql<
        Array<{ store_id: string }>
      >`SELECT store_id FROM store_members WHERE user_id = ${id}`;
      await f.sql`DELETE FROM sessions WHERE user_id = ${id}`;
      await f.sql`DELETE FROM devices WHERE user_id = ${id}`;
      for (const s of stores) {
        await f.sql`DELETE FROM store_members WHERE store_id = ${s.store_id}`;
        await f.sql`DELETE FROM stores WHERE id = ${s.store_id}`;
      }
      await f.sql`DELETE FROM users WHERE id = ${id}`;
    }
  }
  for (const id of globalIds)
    await f.sql`DELETE FROM global_products WHERE id = ${id}`;
  for (const id of brandIds) await f.sql`DELETE FROM brands WHERE id = ${id}`;
  await f.teardown();
});

describe("QA-48 — English product search", () => {
  it("finds a catalog product by its English name or brand, any case", async () => {
    const [brand] = await f.sql<Array<{ id: string }>>`
      INSERT INTO brands (name_ar, name_en)
      VALUES (${`بيبسيكو ${f.runId}`}, ${`PepsiCo${f.runId}`}) RETURNING id`;
    brandIds.push(brand!.id);
    const nameAr = `بيبسي ${f.runId}`;
    const [gp] = await f.sql<Array<{ id: string }>>`
      INSERT INTO global_products (brand_id, name_ar, name_en, name_norm, category, type, status)
      VALUES (${brand!.id}, ${nameAr}, ${`Pepsi Cola ${f.runId}`}, ${nameAr}, 'مشروبات', 'stock', 'approved')
      RETURNING id`;
    globalIds.push(gp!.id);

    for (const q of [
      `pepsi cola ${f.runId}`,
      `PEPSI COLA ${f.runId}`,
      `pepsico${f.runId}`,
      `بيبسي ${f.runId}`,
    ]) {
      const r = await call(
        products.GET as Handler,
        A,
        "GET",
        `/api/products?search=${encodeURIComponent(q)}`,
      );
      expect(r.status).toBe(200);
      const list = r.json.products as Array<{
        global_product_id: string | null;
        name_en?: string | null;
      }>;
      const hit = list.find((p) => p.global_product_id === gp!.id);
      expect(hit, q).toBeTruthy();
      // The screen filters on these fields too.
      expect(hit!.name_en).toBe(`Pepsi Cola ${f.runId}`);
    }
    const none = await call(
      products.GET as Handler,
      A,
      "GET",
      `/api/products?search=${encodeURIComponent(`fanta-${f.runId}`)}`,
    );
    const noneList = none.json.products as Array<{
      global_product_id: string | null;
    }>;
    expect(noneList.some((p) => p.global_product_id === gp!.id)).toBe(false);
  });
});

describe("QA-50 — a failed signup leaves no half-made account", () => {
  it("rolls back the user when a later step fails, and the same phone can sign up again", async () => {
    const email = `qa50-${f.runId}@hesba.test`;
    signedUp.push(email);
    const phone = `012${Math.floor(1e7 + Math.random() * 9e7)}`;
    const password = "QA50-signup-2026-ok";
    const failName = `QA50 fail ${f.runId}`;
    // The last signup step (the device) fails for this store name only.
    await f.sql.unsafe(`
      CREATE OR REPLACE FUNCTION qa50_fail_device() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM stores WHERE id = NEW.store_id AND name = '${failName}') THEN
          RAISE EXCEPTION 'qa50 injected failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await f.sql.unsafe(
      `CREATE TRIGGER qa50_fail_device BEFORE INSERT ON devices
       FOR EACH ROW EXECUTE FUNCTION qa50_fail_device()`,
    );

    const body = (storeName: string) => ({
      ownerName: "فحص التسجيل",
      phone,
      email,
      password,
      storeName,
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    });
    const failed = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      body(failName),
    );
    expect(failed.status).toBeGreaterThanOrEqual(500);
    // Nothing of the failed signup is left: no user, no store, no membership.
    expect(
      await f.sql`SELECT id FROM users WHERE email = ${email}`,
    ).toHaveLength(0);
    expect(
      await f.sql`SELECT id FROM stores WHERE name = ${failName}`,
    ).toHaveLength(0);
    const loginBefore = await call(
      loginRoute as Handler,
      null,
      "POST",
      "/api/auth/login",
      { phone, password },
    );
    expect(loginBefore.status).toBe(401);

    // The retry with the same phone and email succeeds and gives a usable account.
    const ok = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      body(`محل ${f.runId}`),
    );
    expect(ok.status).toBe(200);
    const [user] = await f.sql<
      Array<{ id: string }>
    >`SELECT id FROM users WHERE email = ${email}`;
    const members = await f.sql<
      Array<{ role: string }>
    >`SELECT role FROM store_members WHERE user_id = ${user!.id}`;
    expect(members.map((m) => m.role)).toEqual(["owner"]);
    const login = await call(
      loginRoute as Handler,
      null,
      "POST",
      "/api/auth/login",
      { phone, password },
    );
    expect(login.status).toBe(200);

    // A second signup with the same phone is a clean 409 (and still no extra user).
    const dup = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      body(`محل تاني ${f.runId}`),
    );
    expect(dup.status).toBe(409);
    expect(
      await f.sql`SELECT id FROM users WHERE phone LIKE ${"%" + phone.slice(1)}`,
    ).toHaveLength(1);
  });
});
