/**
 * Stabilization regressions (real Postgres, app role, the real routes with a real session):
 * - GET /api/reports/home, /api/money, /api/drawer (and the services / stocktake reads) answer
 *   200 with the database's numbers for a shop that uses every new table — the 500s seen on a
 *   database without migration 20261123000000 must show up here, never be papered over;
 * - stocktake in إدارة المحل: a «sold» shortage reconciles the daily totals — no second sale,
 *   no loss; in الكاشير الذكي it stays a discovered sale; the mode is stored on the count;
 * - stocktake audit trail: who started / confirmed / abandoned, movements carry the confirm op,
 *   a closed count cannot be rewritten (database trigger);
 * - the drawer is never charged by hand (API 400 and database CHECK);
 * - a cashier service sale (500 paid, machine −490) is a commission of 10, not goods profit.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { MachinesService } from "@/server/modules/machines";
import { recordDrawerCount } from "@/server/modules/drawer";
import {
  abandonInventoryCount,
  confirmInventoryCount,
  startInventoryCount,
  updateInventoryCount,
} from "@/server/modules/inventory";
import { recordMoneyMovement } from "@/server/modules/money";
import { recordServiceTransaction } from "@/server/modules/services";
import { recordDailySales } from "@/server/modules/daily-sales";
import { getHomeReport } from "@/server/modules/reports";
import { GET as homeReportRoute } from "@/app/api/reports/home/route";
import { GET as moneyRoute } from "@/app/api/money/route";
import { POST as moneyMovementRoute } from "@/app/api/money/movements/route";
import { GET as drawerRoute } from "@/app/api/drawer/route";
import { GET as servicesRoute } from "@/app/api/services/route";
import { GET as countsRoute } from "@/app/api/inventory-counts/route";
import { parseHomeReport } from "@/client/shared/api/reports";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const machines = new MachinesService(appPrisma);
const op = () => crypto.randomUUID();
const tokens = new Map<string, string>();

async function call(
  handler: (req: Request) => Promise<Response>,
  shop: Shop,
  method: string,
  path: string,
  body?: unknown,
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
        Origin: "http://localhost:3000",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as Json };
}

const setMode = (shop: Shop, mode: "simple" | "pos") =>
  f.sql`UPDATE stores SET operating_mode = ${mode} WHERE id = ${shop.storeId}`;

let wallet = "";

beforeAll(async () => {
  await f.setup();
  wallet = (
    await machines.upsertMachine(A.storeId, A.userId, {
      name: `محفظة ثبات ${f.runId}`,
      provider: "vodafone_cash",
    })
  ).id;
  await recordDrawerCount(A.storeId, A.userId, {
    opId: op(),
    countedPiasters: 100_000,
  });
}, 120_000);

afterAll(async () => {
  const ids = [A.storeId, B.storeId];
  const sql = f.sql;
  await setMode(A, "pos");
  await setMode(B, "pos");
  await sql`DELETE FROM service_transactions WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM money_movements WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM inventory_counts WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM daily_sales_entries WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM debt_entries WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM pos_machine_topups WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM cash_drawer_counts WHERE store_id IN ${sql(ids)}`;
  await sql`DELETE FROM pos_machines WHERE store_id IN ${sql(ids)}`;
  await f.teardown();
});

describe("the reads that returned 500 answer from the database", () => {
  it("GET /api/reports/home, /api/money, /api/drawer, /api/services, /api/inventory-counts", async () => {
    // Every new table holds a row: a money movement, a service, a confirmed count.
    await recordMoneyMovement(A.storeId, A.userId, {
      opId: op(),
      kind: "transfer",
      amountPiasters: 30_000,
      from: "cash",
      to: { machineId: wallet },
    });
    const deposit = (
      await f.product(A, {
        name: "إيداع محفظة",
        sell: 500,
        category: "تحويل أموال",
      })
    ).productId;
    await recordServiceTransaction(A.storeId, A.userId, {
      opId: op(),
      serviceProductId: deposit,
      direction: "send",
      amountPiasters: 10_000,
      commissionPiasters: 500,
      floatMachineId: wallet,
      payment: "cash",
    });
    const v = (await f.product(A, { name: "ثبات جرد", sell: 1000 })).variantId;
    await f.addStock(A, v, 4, { cost: 2400 });
    const c = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: [v],
    });
    await updateInventoryCount(A.storeId, A.userId, c.id, {
      lines: [{ variantId: v, countedBase: 3 }],
    });
    await confirmInventoryCount(A.storeId, A.userId, c.id, op());

    const home = await call(
      homeReportRoute,
      A,
      "GET",
      "/api/reports/home?period=today",
    );
    expect(home.status).toBe(200);
    const report = parseHomeReport(home.json);
    // The route's numbers are the service's numbers (no default / fake data).
    const direct = await getHomeReport(A.storeId, A.userId, "today");
    expect(report.profit).toEqual(direct.profit);
    expect(report.profit!.serviceCommissionsPiasters).toBe(500);
    expect(report.profit!.inventoryLossesPiasters).toBe(600);

    const money = await call(moneyRoute, A, "GET", "/api/money");
    expect(money.status).toBe(200);
    const accounts = money.json.accounts as Array<{
      id: string;
      balancePiasters: number | null;
    }>;
    // Drawer: 1,000 counted − 300 transferred + 100 + 5 from the service's customer.
    expect(accounts.find((a) => a.id === "cash")!.balancePiasters).toBe(
      100_000 - 30_000 + 10_500,
    );
    // Wallet: + 300 transferred − 100 sent for the customer.
    expect(accounts.find((a) => a.id === wallet)!.balancePiasters).toBe(
      30_000 - 10_000,
    );

    const drawer = await call(drawerRoute, A, "GET", "/api/drawer");
    expect(drawer.status).toBe(200);
    expect(
      (drawer.json.drawer as { expectedPiasters: number }).expectedPiasters,
    ).toBe(100_000 - 30_000 + 10_500);

    const services = await call(servicesRoute, A, "GET", "/api/services");
    expect(services.status).toBe(200);
    const counts = await call(countsRoute, A, "GET", "/api/inventory-counts");
    expect(counts.status).toBe(200);

    // Another shop sees none of it.
    const other = await call(moneyRoute, B, "GET", "/api/money");
    expect(other.status).toBe(200);
    expect(
      (other.json.accounts as Array<{ id: string }>).some(
        (a) => a.id === wallet,
      ),
    ).toBe(false);
  });
});

describe("stocktake: «sold» by operating mode, and the audit trail", () => {
  it("إدارة المحل: a «sold» shortage reconciles the daily totals — no second sale, no loss", async () => {
    await setMode(A, "simple");
    try {
      const v = (await f.product(A, { name: "بسيط مباع", sell: 1000 }))
        .variantId;
      await f.addStock(A, v, 10, { cost: 6000 });
      // The day's sales total (its money) — 3 pieces were sold, at 10.00 each.
      await recordDailySales(A.storeId, A.userId, {
        opId: op(),
        cashPiasters: 3000,
        parts: [],
        credits: [],
        items: [],
      });
      const before = await getHomeReport(A.storeId, A.userId, "today");

      const c = await startInventoryCount(A.storeId, A.userId, {
        opId: op(),
        scope: "selected",
        variantIds: [v],
      });
      const counted = await updateInventoryCount(A.storeId, A.userId, c.id, {
        lines: [{ variantId: v, countedBase: 7, reason: "unrecorded_sale" }],
      });
      expect(counted.salesMode).toBe("simple");
      // The review never promises a sale value in this mode.
      expect(counted.totals.unrecordedSaleSellPiasters).toBe(0);
      const done = await confirmInventoryCount(A.storeId, A.userId, c.id, op());
      expect(done.salesMode).toBe("simple");
      expect((await f.stockState(A, v)).level).toBe(7);

      const after = await getHomeReport(A.storeId, A.userId, "today");
      // Revenue is the daily total only, once.
      expect(after.profit!.productSalesPiasters).toBe(
        before.profit!.productSalesPiasters,
      );
      expect(after.profit!.discoveredSalesPiasters).toBe(
        before.profit!.discoveredSalesPiasters,
      );
      // Not a loss either: the goods were sold, their money is in the total.
      expect(after.profit!.inventoryLossesPiasters).toBe(
        before.profit!.inventoryLossesPiasters,
      );
      expect(after.profit!.notes.join(" ")).toContain("إجمالي المبيعات اليومي");
    } finally {
      await setMode(A, "pos");
    }
  });

  it("الكاشير الذكي: the same shortage is a discovered sale; the mode is fixed on the count", async () => {
    const v = (await f.product(A, { name: "كاشير مباع", sell: 1000 }))
      .variantId;
    await f.addStock(A, v, 10, { cost: 6000 });
    const before = await getHomeReport(A.storeId, A.userId, "today");
    const c = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: [v],
    });
    await updateInventoryCount(A.storeId, A.userId, c.id, {
      lines: [{ variantId: v, countedBase: 8, reason: "unrecorded_sale" }],
    });
    const confirmOp = op();
    const done = await confirmInventoryCount(
      A.storeId,
      A.userId,
      c.id,
      confirmOp,
    );
    expect(done.salesMode).toBe("pos");
    const after = await getHomeReport(A.storeId, A.userId, "today");
    expect(
      after.profit!.discoveredSalesPiasters -
        before.profit!.discoveredSalesPiasters,
    ).toBe(2000);

    // Switching the shop's mode later never rewrites this count's history.
    await setMode(A, "simple");
    try {
      const later = await getHomeReport(A.storeId, A.userId, "today");
      expect(later.profit!.discoveredSalesPiasters).toBe(
        after.profit!.discoveredSalesPiasters,
      );
    } finally {
      await setMode(A, "pos");
    }

    // Audit trail: who and when, and every movement it made carries the confirm op.
    const row = (
      await f.sql<
        Array<{
          created_by: string;
          confirmed_by: string;
          operating_mode: string;
        }>
      >`SELECT created_by, confirmed_by, operating_mode FROM inventory_counts WHERE id = ${c.id}`
    )[0]!;
    expect(row).toEqual({
      created_by: A.userId,
      confirmed_by: A.userId,
      operating_mode: "pos",
    });
    const moves = await f.sql<Array<{ op_id: string; type: string }>>`
      SELECT op_id, type FROM stock_movements
       WHERE store_id = ${A.storeId} AND store_variant_id = ${v} AND type = 'count_adjustment'`;
    expect(moves).toEqual([{ op_id: confirmOp, type: "count_adjustment" }]);

    // A closed count is history: the app role cannot rewrite who / when / the mode.
    await expect(
      f.as(A, (tx) =>
        tx.inventoryCount.update({
          where: { id: c.id },
          data: { operatingMode: "simple" },
        }),
      ),
    ).rejects.toThrow(/closed|already|check/i);
  });

  it("an abandoned count records who abandoned it and changes no stock", async () => {
    const v = (await f.product(A, { name: "ملغي مراجعة", sell: 500 }))
      .variantId;
    await f.addStock(A, v, 5);
    const c = await startInventoryCount(A.storeId, A.userId, {
      opId: op(),
      scope: "selected",
      variantIds: [v],
    });
    await updateInventoryCount(A.storeId, A.userId, c.id, {
      lines: [{ variantId: v, countedBase: 0, reason: "lost" }],
    });
    await abandonInventoryCount(A.storeId, A.userId, c.id);
    expect((await f.stockState(A, v)).level).toBe(5);
    const row = (
      await f.sql<Array<{ abandoned_by: string; status: string }>>`
        SELECT abandoned_by, status FROM inventory_counts WHERE id = ${c.id}`
    )[0]!;
    expect(row).toEqual({ abandoned_by: A.userId, status: "abandoned" });
  });
});

describe("«فلوس حِسبة»: the drawer is never charged by hand", () => {
  it("an owner deposit into the drawer is refused by the API and by the database", async () => {
    const res = await call(
      moneyMovementRoute,
      A,
      "POST",
      "/api/money/movements",
      {
        opId: op(),
        kind: "owner_deposit",
        amountPiasters: 5000,
        to: "cash",
      },
    );
    expect(res.status).toBe(400);
    await expect(
      f.as(A, (tx) =>
        tx.moneyMovement.create({
          data: {
            storeId: A.storeId,
            opId: op(),
            kind: "owner_deposit",
            amountPiasters: BigInt(5000),
            toCash: true,
          },
        }),
      ),
    ).rejects.toThrow(/money_movements_shape_check|check/i);
    // Into a wallet it is allowed (and never income).
    const ok = await call(
      moneyMovementRoute,
      A,
      "POST",
      "/api/money/movements",
      {
        opId: op(),
        kind: "owner_deposit",
        amountPiasters: 5000,
        to: { machineId: wallet },
      },
    );
    expect(ok.status).toBe(201);
  });
});

describe("a cashier service sale is a commission, not goods", () => {
  it("500 paid, machine −490 → commission 10; goods sales and goods profit unchanged", async () => {
    const m = await machines.upsertMachine(A.storeId, A.userId, {
      name: `فوري كاشير ${f.runId}`,
      provider: "fawry",
    });
    await machines.topupMachine(A.storeId, A.userId, m.id, 100_000, {
      opId: op(),
      source: "خارجي",
    });
    const svc = await f.product(A, {
      name: "فاتورة كهربا",
      sell: 500,
      category: "شحن رصيد",
    });
    const before = await getHomeReport(A.storeId, A.userId, "today");
    const sale = await f.request(A, "POST", {
      productId: svc.productId,
      amountPiasters: 50_000,
      machineId: m.id,
      machineDeductPiasters: 49_000,
      opId: op(),
    });
    expect(sale.status).toBe(200);
    const after = await getHomeReport(A.storeId, A.userId, "today");
    const d = (k: keyof NonNullable<typeof after.profit>) =>
      (after.profit![k] as number) - (before.profit![k] as number);
    expect(d("serviceCommissionsPiasters")).toBe(1000);
    expect(d("serviceOperationsPiasters")).toBe(49_000);
    expect(d("productSalesPiasters")).toBe(0);
    expect(d("knownCogsPiasters")).toBe(0);
    if (
      before.profit!.netProfitPiasters !== null &&
      after.profit!.netProfitPiasters !== null
    ) {
      expect(d("netProfitPiasters")).toBe(1000);
      expect(d("grossProfitPiasters")).toBe(0);
    }
  });
});
