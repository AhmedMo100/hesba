/**
 * «تصدير» on التقارير and الجرد: a signed-in shop only, its own data only, the period checked,
 * and the file's figures equal the report the screen reads (`/api/reports/home`), and stock
 * received in a range listed in full.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { GET as reportExport } from "@/app/api/reports/export/route";
import { GET as stockExport } from "@/app/api/stock/export/route";
import { GET as reportHome } from "@/app/api/reports/home/route";
import { GET as stockGet } from "@/app/api/stock/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { SaleFixtures, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const tokens = new Map<string, string>();

async function get(
  handler: (req: Request) => Promise<Response>,
  shop: Shop | null,
  path: string,
) {
  let cookie = "";
  if (shop) {
    let token = tokens.get(shop.storeId);
    if (!token) {
      token = (await createSession(shop.userId, shop.storeId)).rawToken;
      tokens.set(shop.storeId, token);
    }
    cookie = `hesba_session=${token}`;
  }
  return handler(
    new Request(`http://localhost:3000${path}`, { headers: { cookie } }),
  );
}

describe("exports", () => {
  let variantId: string;
  beforeAll(async () => {
    await f.setup();
    ({ variantId } = await f.product(A, {
      name: "زيت التصدير",
      sell: 12345,
      buy: 9000,
    }));
    await f.addStock(A, variantId, 30, { cost: 270000 });
    const token = (await createSession(A.userId, A.storeId)).rawToken;
    tokens.set(A.storeId, token);
    const res = await checkoutRoute(
      new Request("http://localhost:3000/api/sales/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `hesba_session=${token}`,
        },
        body: JSON.stringify({
          opId: crypto.randomUUID(),
          lines: [{ variantId, quantityBase: 3 }],
          discountPiasters: 0,
          paymentMethod: "cash",
          paidNowPiasters: 0,
        }),
      }),
    );
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await f.teardown();
  });

  it("needs a session; checks the period and the format", async () => {
    expect(
      (await get(reportExport, null, "/api/reports/export?period=today"))
        .status,
    ).toBe(401);
    expect((await get(stockExport, null, "/api/stock/export")).status).toBe(
      401,
    );
    expect(
      (await get(reportExport, A, "/api/reports/export?period=nope")).status,
    ).toBe(400);
    expect(
      (await get(stockExport, A, "/api/stock/export?format=pdf")).status,
    ).toBe(400);
    expect(
      (
        await get(
          reportExport,
          A,
          "/api/reports/export?period=custom&from=2026-99-01&to=2026-01-01",
        )
      ).status,
    ).toBe(400);
  });

  it("the report file has the report's own figures", async () => {
    const home = await (
      await get(reportHome, A, "/api/reports/home?period=today")
    ).json();
    const res = await get(
      reportExport,
      A,
      "/api/reports/export?period=today&format=csv",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const csv = await res.text();
    const revenue = (home.sales.revenuePiasters as number) / 100;
    expect(home.sales.revenuePiasters).toBe(37035);
    expect(csv).toContain(`بعت بكام,${revenue.toFixed(2)}`);
    expect(csv).toContain("زيت التصدير");
    const xlsx = await get(reportExport, A, "/api/reports/export?period=month");
    expect(xlsx.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(xlsx.headers.get("Content-Disposition")).toContain(".xlsx");
    const bytes = new Uint8Array(await xlsx.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("the stocktake file is this shop's only, values exact", async () => {
    const mine = await (
      await get(stockExport, A, "/api/stock/export?format=csv")
    ).text();
    expect(mine).toContain("زيت التصدير");
    // 27 left × 123.45 = 3333.15 at the sell price, × 90.00 = 2430.00 at the buy price.
    expect(mine).toContain("2430.00");
    expect(mine).toContain("3333.15");
    const theirs = await (
      await get(stockExport, B, "/api/stock/export?format=csv")
    ).text();
    expect(theirs).not.toContain("زيت التصدير");
  });

  it("stock received in a range is listed in full", async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const res = await get(
      stockGet,
      A,
      `/api/stock?view=additions&from=${from}&to=${to}`,
    );
    const { movements } = (await res.json()) as {
      movements: Array<{ type: string; quantityBase: number }>;
    };
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: "purchase",
      quantityBase: 30,
    });
    expect(
      (await get(stockGet, A, "/api/stock?view=additions&from=bad&to=x"))
        .status,
    ).toBe(400);
  });
});
