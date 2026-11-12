/**
 * QA-32 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0027): on Neon every database round trip costs
 * ~63 ms from Egypt (measured 2026-11-11), so an endpoint's latency is about
 * (round trips × 63 ms). This pins the round trips of the main screens' requests — BEGIN /
 * COMMIT included — so an N+1 or a repeated query cannot creep back in unnoticed.
 *
 * Real route handlers, real sessions, real Postgres; the app client emits query events only
 * because HESBA_PRISMA_QUERY_EVENTS is set before it is created.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env["HESBA_PRISMA_QUERY_EVENTS"] = "1";
});

import { prisma } from "@/server/infra/db/client";
import { createSession } from "@/server/modules/auth";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as alerts } from "@/app/api/alerts/route";
import { GET as machines } from "@/app/api/machines/route";
import { GET as stock } from "@/app/api/stock/route";
import { GET as products } from "@/app/api/products/route";
import { GET as sandwiches } from "@/app/api/sandwiches/route";
import { GET as salesConfig } from "@/app/api/sales/config/route";
import { GET as promotions } from "@/app/api/promotions/route";
import { GET as sales } from "@/app/api/sales/route";
import { GET as people } from "@/app/api/people/route";
import { GET as expenses } from "@/app/api/expenses/route";
import { GET as home } from "@/app/api/reports/home/route";
import { SaleFixtures } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
let token = "";
let counting = false;
let count = 0;

const trace: string[] = [];
(
  prisma as unknown as {
    $on: (e: string, cb: (ev: { query: string }) => void) => void;
  }
).$on("query", (ev) => {
  if (!counting) return;
  count += 1;
  if (process.env["HESBA_QUERY_TRACE"]) trace.push(ev.query.slice(0, 140));
});

async function roundTrips(
  handler: (req: Request) => Promise<Response>,
  path: string,
): Promise<number> {
  const req = new Request(`http://localhost:3000${path}`, {
    headers: { cookie: `hesba_session=${token}` },
  });
  count = 0;
  counting = true;
  const res = await handler(req);
  counting = false;
  if (
    process.env["HESBA_QUERY_TRACE"] &&
    path.startsWith(process.env["HESBA_QUERY_TRACE"])
  ) {
    console.log(`TRACE ${path}\n` + trace.join("\n"));
  }
  trace.length = 0;
  expect(res.status).toBe(200);
  return count;
}

const endpoints: Array<[string, (req: Request) => Promise<Response>, string]> =
  [
    ["session", session as never, "/api/auth/session"],
    ["alerts", alerts as never, "/api/alerts"],
    ["machines", machines as never, "/api/machines"],
    ["stock", stock as never, "/api/stock"],
    ["stockAll", stock as never, "/api/stock?view=all"],
    ["products", products as never, "/api/products?filter=all"],
    ["sandwiches", sandwiches as never, "/api/sandwiches"],
    ["salesConfig", salesConfig as never, "/api/sales/config"],
    ["promotions", promotions as never, "/api/promotions"],
    ["sales", sales as never, "/api/sales"],
    ["people", people as never, "/api/people?section=owedToMe"],
    ["expenses", expenses as never, "/api/expenses?period=month"],
    ["home", home as never, "/api/reports/home?period=today"],
  ];

/** Round trips measured for each endpoint (see the test below). */
const measured: Record<string, number> = {};

/**
 * The budget per request (2026-11-11), after the QA-32 changes. Before → after:
 * every request −1 (one set_config statement per tenant transaction) and −1 (lastSeenAt
 * refreshed at most every 5 min) — e.g. session 8→6, sales config 13→10, sales 18→15,
 * home 24→21. Sales/Home read `/api/stock` without the movement history (2 transactions → 1).
 */
const BUDGET: Record<string, number> = {
  session: 6,
  alerts: 13,
  machines: 10,
  stock: 13,
  stockAll: 20,
  products: 16,
  sandwiches: 10,
  salesConfig: 10,
  promotions: 10,
  sales: 15,
  people: 10,
  expenses: 10,
  home: 22, // +1: the losses of the period (P4, waste_records)
};

beforeAll(async () => {
  await f.setup();
  token = (await createSession(f.shopA.userId, f.shopA.storeId)).rawToken;
  // A realistic small shop: 15 stocked products and a few sales.
  for (let i = 0; i < 15; i++) {
    const p = await f.product(f.shopA, {
      name: `منتج قياس ${i}`,
      sell: 1000 + i,
    });
    await f.addStock(f.shopA, p.variantId, 20, {
      expiry: i % 3 === 0 ? "2026-11-20" : undefined,
    });
    if (i < 5) await f.sell(f.shopA, p.variantId, 1);
  }
}, 120_000);
afterAll(() => f.teardown());

describe("QA-32 — database round trips per request", () => {
  it("each main endpoint stays within its round-trip budget", async () => {
    for (const [name, handler, path] of endpoints) {
      measured[name] = await roundTrips(handler, path);
    }
    console.log("round trips per request:", JSON.stringify(measured));
    for (const [name, n] of Object.entries(measured)) {
      expect({ name, roundTrips: n }).toEqual({
        name,
        roundTrips: Math.min(n, BUDGET[name]!),
      });
    }
  });
});
