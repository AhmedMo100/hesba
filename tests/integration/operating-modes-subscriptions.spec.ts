/**
 * ADR-0033, enforced on the server (real Postgres, the app's route handlers and roles):
 * - sign-up stores the chosen operating mode and the database starts a 72-hour trial;
 * - each mode's features are refused through the API in the other mode, and switching modes
 *   (both ways, several times) changes nothing but the mode — no data, no trial restart;
 * - an expired or suspended shop can call nothing protected, only its subscription status,
 *   the session and logout; Hesba's manual renewal works, keeps remaining days, and the app can
 *   never touch a subscription field (trigger, revoked function, strict body);
 * - the daily sales total (إدارة المحل) moves the drawer and the wallets atomically.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "@/server/modules/auth";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { MachinesService } from "@/server/modules/machines";
import { getDrawer, recordDrawerCount } from "@/server/modules/drawer";
import { POST as signupRoute } from "@/app/api/auth/signup/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as subscriptionRoute } from "@/app/api/subscription/route";
import { PATCH as modeRoute } from "@/app/api/store/operating-mode/route";
import * as products from "@/app/api/products/route";
import * as stock from "@/app/api/stock/route";
import * as sales from "@/app/api/sales/route";
import { POST as checkoutRoute } from "@/app/api/sales/checkout/route";
import { POST as voidRoute } from "@/app/api/sales/void/route";
import { POST as returnRoute } from "@/app/api/sales/[id]/returns/route";
import { GET as saleRoute } from "@/app/api/sales/[id]/route";
import * as expenses from "@/app/api/expenses/route";
import * as people from "@/app/api/people/route";
import * as drawer from "@/app/api/drawer/route";
import { GET as reportRoute } from "@/app/api/reports/home/route";
import { POST as aiChatRoute } from "@/app/api/ai/chat/route";
import { GET as catalogSyncRoute } from "@/app/api/sync/catalog/route";
import * as dailySales from "@/app/api/daily-sales/route";
import { DELETE as dailyCancelRoute } from "@/app/api/daily-sales/[id]/route";
import { BusinessToolsService } from "@/server/modules/ai/tools/business-tools";
import { SaleFixtures, type Json, type Shop } from "./helpers/sale-fixtures";
import { toCairoDateString } from "@/domain/time";
import { monthQuery } from "@/domain/report-periods";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;
const machines = new MachinesService(appPrisma);
const tokens = new Map<string, string>();
type Handler = (req: Request, ctx: never) => Promise<Response>;

async function call(
  handler: Handler,
  shop: Shop | null,
  method: string,
  path: string,
  body?: unknown,
  id = "",
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  let cookie = "";
  if (shop) {
    let token = tokens.get(shop.storeId);
    if (!token) {
      token = (await createSession(shop.userId, shop.storeId)).rawToken;
      tokens.set(shop.storeId, token);
    }
    cookie = `hesba_session=${token}`;
  }
  const res = await handler(
    new Request(`http://localhost:3000${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) } as never,
  );
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
}

const storeRow = async (storeId: string) =>
  (
    await f.sql<
      Array<{
        operating_mode: string;
        subscription_status: string;
        trial_started_at: Date | null;
        trial_ends_at: Date | null;
        subscription_ends_at: Date | null;
        subscription_started_at: Date | null;
      }>
    >`SELECT operating_mode, subscription_status, trial_started_at, trial_ends_at,
             subscription_started_at, subscription_ends_at
        FROM stores WHERE id = ${storeId}`
  )[0]!;

const setMode = async (storeId: string, mode: string) =>
  f.sql`UPDATE stores SET operating_mode = ${mode} WHERE id = ${storeId}`;

const signupBody = (tag: string, mode?: string) => ({
  ownerName: "صاحب التجربة",
  phone: `011${String(Math.floor(1e7 + Math.random() * 9e7))}`,
  email: `mode-${tag}-${f.runId}@hesba.test`,
  password: "Trial-flow-2026-ok",
  storeName: `محل ${tag} ${f.runId}`,
  shopType: "سوبر ماركت",
  governorate: "القاهرة",
  ...(mode ? { operatingMode: mode } : {}),
});

describe("operating modes and subscriptions (ADR-0033)", () => {
  const signedUp: string[] = [];
  let variantId: string;

  beforeAll(async () => {
    await f.setup();
    ({ variantId } = await f.product(A, {
      name: "زيت",
      sell: 10000,
      buy: 8000,
    }));
    await f.addStock(A, variantId, 50);
  });

  afterAll(async () => {
    for (const id of signedUp) {
      await f.sql`DELETE FROM sessions WHERE store_id = ${id}`;
      await f.sql`DELETE FROM devices WHERE store_id = ${id}`;
      const members = await f.sql<Array<{ user_id: string }>>`
        SELECT user_id FROM store_members WHERE store_id = ${id}`;
      await f.sql`DELETE FROM store_members WHERE store_id = ${id}`;
      await f.sql`DELETE FROM stores WHERE id = ${id}`;
      for (const m of members)
        await f.sql`DELETE FROM users WHERE id = ${m.user_id}`;
    }
    await f.teardown();
  });

  // ─── Sign-up and the trial ────────────────────────────────────────────────
  it.each(["simple", "pos"])(
    "sign-up in «%s» stores the mode and starts a 72-hour trial from the database clock",
    async (mode) => {
      const before = Date.now();
      const r = await call(
        signupRoute as Handler,
        null,
        "POST",
        "/api/auth/signup",
        signupBody(mode, mode),
      );
      expect(r.status).toBe(200);
      const data = r.json.data as {
        store: {
          id: string;
          operatingMode: string;
          subscription: {
            status: string;
            allowed: boolean;
            trialEndsAt: string;
          };
        };
      };
      signedUp.push(data.store.id);
      expect(data.store.operatingMode).toBe(mode);
      expect(data.store.subscription.status).toBe("trialing");
      expect(data.store.subscription.allowed).toBe(true);
      const row = await storeRow(data.store.id);
      expect(row.operating_mode).toBe(mode);
      expect(row.subscription_status).toBe("trialing");
      // Exactly 72 hours, starting when the shop was created (not before the request).
      expect(
        row.trial_ends_at!.getTime() - row.trial_started_at!.getTime(),
      ).toBe(72 * 3600_000);
      expect(row.trial_started_at!.getTime()).toBeGreaterThanOrEqual(
        before - 5_000,
      );
      expect(row.subscription_ends_at).toBeNull();
    },
  );

  it("sign-up without choosing a mode is refused (never picked silently)", async () => {
    const r = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      signupBody("none"),
    );
    expect(r.status).toBe(400);
    const r2 = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      signupBody("bad", "both"),
    );
    expect(r2.status).toBe(400);
  });

  it("a client cannot forge its trial or a paid period at sign-up", async () => {
    const r = await call(
      signupRoute as Handler,
      null,
      "POST",
      "/api/auth/signup",
      {
        ...signupBody("forge", "pos"),
        subscriptionStatus: "active",
        subscriptionEndsAt: "2099-01-01T00:00:00Z",
        trialEndsAt: "2099-01-01T00:00:00Z",
      },
    );
    expect(r.status).toBe(200);
    const id = (r.json.data as { store: { id: string } }).store.id;
    signedUp.push(id);
    const row = await storeRow(id);
    expect(row.subscription_status).toBe("trialing");
    expect(row.trial_ends_at!.getTime() - row.trial_started_at!.getTime()).toBe(
      72 * 3600_000,
    );
    expect(row.subscription_ends_at).toBeNull();
  });

  // ─── Modes ────────────────────────────────────────────────────────────────
  it("إدارة المحل: the cashier's writes are refused by the API; old invoices stay readable", async () => {
    await setMode(A.storeId, "pos");
    const sold = await call(
      checkoutRoute as Handler,
      A,
      "POST",
      "/api/sales/checkout",
      {
        opId: crypto.randomUUID(),
        lines: [{ variantId, quantityBase: 2 }],
        discountPiasters: 0,
        paymentMethod: "cash",
        paidNowPiasters: 0,
      },
    );
    expect(sold.status).toBe(201);
    const invoice = sold.json.invoice as {
      id: string;
      lines: Array<{ id: string }>;
    };

    await setMode(A.storeId, "simple");
    const refused = [
      await call(sales.POST as Handler, A, "POST", "/api/sales", {
        opId: crypto.randomUUID(),
      }),
      await call(checkoutRoute as Handler, A, "POST", "/api/sales/checkout", {
        opId: crypto.randomUUID(),
        lines: [{ variantId, quantityBase: 1 }],
        discountPiasters: 0,
        paymentMethod: "cash",
        paidNowPiasters: 0,
      }),
      await call(voidRoute as Handler, A, "POST", "/api/sales/void", {
        saleId: invoice.id,
        opId: crypto.randomUUID(),
      }),
      await call(
        returnRoute as Handler,
        A,
        "POST",
        `/api/sales/${invoice.id}/returns`,
        {
          opId: crypto.randomUUID(),
          lines: [{ saleLineId: invoice.lines[0]!.id, quantityBase: 1 }],
        },
        invoice.id,
      ),
    ];
    for (const r of refused) {
      expect(r.status).toBe(403);
      expect((r.json.error as { code: string }).code).toBe("MODE_FORBIDDEN");
    }
    // History is kept and readable.
    const read = await call(
      saleRoute as Handler,
      A,
      "GET",
      `/api/sales/${invoice.id}`,
      undefined,
      invoice.id,
    );
    expect(read.status).toBe(200);
    const list = await call(sales.GET as Handler, A, "GET", "/api/sales");
    expect(list.status).toBe(200);
  });

  it("الكاشير الذكي: the daily total is refused (sales are recorded one by one)", async () => {
    await setMode(A.storeId, "pos");
    const r = await call(
      dailySales.POST as Handler,
      A,
      "POST",
      "/api/daily-sales",
      {
        opId: crypto.randomUUID(),
        cashPiasters: 1000,
      },
    );
    expect(r.status).toBe(403);
    expect((r.json.error as { code: string }).code).toBe("MODE_FORBIDDEN");
  });

  it("switching modes back and forth changes only the mode: no data, no trial restart, no invented sales", async () => {
    await setMode(A.storeId, "pos");
    const snapshot = async () =>
      f.as(A, async (tx) => ({
        products: await tx.storeProduct.count({
          where: { storeId: A.storeId },
        }),
        variants: await tx.storeVariant.findMany({
          where: { storeId: A.storeId },
          select: { id: true, sellPricePiasters: true, buyPricePiasters: true },
          orderBy: { id: "asc" },
        }),
        stock: await tx.stockLevel.findMany({
          where: { storeId: A.storeId },
          select: { storeVariantId: true, quantityBase: true },
          orderBy: { storeVariantId: "asc" },
        }),
        batches: await tx.storeStockBatch.count({
          where: { storeId: A.storeId },
        }),
        movements: await tx.stockMovement.count({
          where: { storeId: A.storeId },
        }),
        sales: await tx.sale.count({ where: { storeId: A.storeId } }),
        saleLines: await tx.saleLine.count({ where: { storeId: A.storeId } }),
        returns: await tx.saleReturn.count({ where: { storeId: A.storeId } }),
        customers: await tx.customer.count({ where: { storeId: A.storeId } }),
        suppliers: await tx.supplier.count({ where: { storeId: A.storeId } }),
        debts: await tx.debtEntry.count({ where: { storeId: A.storeId } }),
        expenses: await tx.expense.count({ where: { storeId: A.storeId } }),
        machines: await tx.posMachine.findMany({
          where: { storeId: A.storeId },
          select: { id: true, currentBalancePiasters: true },
          orderBy: { id: "asc" },
        }),
        counts: await tx.cashDrawerCount.count({
          where: { storeId: A.storeId },
        }),
      }));
    const subBefore = await storeRow(A.storeId);
    const before = await snapshot();
    for (const mode of ["simple", "pos", "simple", "pos", "simple", "pos"]) {
      const r = await call(
        modeRoute as Handler,
        A,
        "PATCH",
        "/api/store/operating-mode",
        { operatingMode: mode },
      );
      expect(r.status).toBe(200);
      expect(r.json.operatingMode).toBe(mode);
      expect((await storeRow(A.storeId)).operating_mode).toBe(mode);
    }
    expect(await snapshot()).toEqual(before);
    const subAfter = await storeRow(A.storeId);
    expect(subAfter.trial_started_at).toEqual(subBefore.trial_started_at);
    expect(subAfter.trial_ends_at).toEqual(subBefore.trial_ends_at);
    expect(subAfter.subscription_status).toBe(subBefore.subscription_status);
    // The same mode again is a no-op.
    const same = await call(
      modeRoute as Handler,
      A,
      "PATCH",
      "/api/store/operating-mode",
      { operatingMode: "pos" },
    );
    expect(same.json.changed).toBe(false);
  });

  it("the mode route takes the mode only, for the session's own shop", async () => {
    const bStore = await storeRow(B.storeId);
    const sneaky = await call(
      modeRoute as Handler,
      A,
      "PATCH",
      "/api/store/operating-mode",
      {
        operatingMode: "simple",
        storeId: B.storeId,
      },
    );
    expect(sneaky.status).toBe(400);
    const extend = await call(
      modeRoute as Handler,
      A,
      "PATCH",
      "/api/store/operating-mode",
      {
        operatingMode: "simple",
        subscriptionEndsAt: "2099-01-01T00:00:00Z",
      },
    );
    expect(extend.status).toBe(400);
    expect((await storeRow(B.storeId)).operating_mode).toBe(
      bStore.operating_mode,
    );
    expect(
      await call(
        modeRoute as Handler,
        null,
        "PATCH",
        "/api/store/operating-mode",
        { operatingMode: "simple" },
      ),
    ).toMatchObject({ status: 401 });
  });

  it("the app role can never write a subscription field, nor run the renewal function", async () => {
    await expect(
      withTenant(A.storeId, A.userId, (tx) =>
        tx.store.update({
          where: { id: A.storeId },
          data: { subscriptionEndsAt: new Date("2099-01-01") },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(A.storeId, A.userId, (tx) =>
        tx.store.update({
          where: { id: A.storeId },
          data: {
            subscriptionStatus: "active",
            subscriptionEndsAt: new Date("2099-01-01"),
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(
        A.storeId,
        A.userId,
        (tx) =>
          tx.$queryRaw`SELECT * FROM hesba_renew_subscription(${A.storeId}::uuid, 12)`,
      ),
    ).rejects.toThrow(/permission denied/);
    // Other shop fields still change normally.
    await withTenant(A.storeId, A.userId, (tx) =>
      tx.store.update({
        where: { id: A.storeId },
        data: { area: "وسط البلد" },
      }),
    );
  });

  // ─── The subscription ─────────────────────────────────────────────────────
  const protectedCalls = (shop: Shop) => [
    () => call(products.GET as Handler, shop, "GET", "/api/products"),
    () => call(products.POST as Handler, shop, "POST", "/api/products", {}),
    () => call(stock.GET as Handler, shop, "GET", "/api/stock"),
    () =>
      call(stock.POST as Handler, shop, "POST", "/api/stock", {
        action: "add",
      }),
    () => call(sales.POST as Handler, shop, "POST", "/api/sales", {}),
    () =>
      call(expenses.POST as Handler, shop, "POST", "/api/expenses", {
        category: "نقل",
        amountPiasters: 100,
        paidFrom: "cash",
      }),
    () =>
      call(people.POST as Handler, shop, "POST", "/api/people", {
        name: "x",
        section: "owedToMe",
        amountEgp: "0",
      }),
    () => call(drawer.GET as Handler, shop, "GET", "/api/drawer"),
    () =>
      call(drawer.POST as Handler, shop, "POST", "/api/drawer", {
        opId: crypto.randomUUID(),
        countedPiasters: 1,
      }),
    () =>
      call(
        reportRoute as Handler,
        shop,
        "GET",
        "/api/reports/home?period=today",
      ),
    () =>
      call(aiChatRoute as Handler, shop, "POST", "/api/ai/chat", {
        message: "مبيعات النهارده",
      }),
    () => call(catalogSyncRoute as Handler, shop, "GET", "/api/sync/catalog"),
    () =>
      call(modeRoute as Handler, shop, "PATCH", "/api/store/operating-mode", {
        operatingMode: "simple",
      }),
    () => call(dailySales.GET as Handler, shop, "GET", "/api/daily-sales"),
  ];

  it("allowed during the trial", async () => {
    const r = await call(products.GET as Handler, A, "GET", "/api/products");
    expect(r.status).toBe(200);
    const s = await call(
      subscriptionRoute as Handler,
      A,
      "GET",
      "/api/subscription",
    );
    expect((s.json.subscription as { status: string }).status).toBe("trialing");
  });

  it("after the trial ends (no cron ran): every protected call is refused; status, session and logout still work", async () => {
    await f.sql`UPDATE stores SET trial_ends_at = now() - interval '1 second' WHERE id = ${A.storeId}`;
    for (const c of protectedCalls(A)) {
      const r = await c();
      expect(r.status, JSON.stringify(r.json).slice(0, 120)).toBe(402);
      expect((r.json.error as { code: string }).code).toBe(
        "SUBSCRIPTION_INACTIVE",
      );
    }
    const s = await call(
      subscriptionRoute as Handler,
      A,
      "GET",
      "/api/subscription",
    );
    expect(s.status).toBe(200);
    expect(
      s.json.subscription as { status: string; allowed: boolean },
    ).toMatchObject({ status: "expired", allowed: false });
    const session = await call(
      sessionRoute as Handler,
      A,
      "GET",
      "/api/auth/session",
    );
    expect(session.status).toBe(200);
    expect(
      (session.json.data as { store: { subscription: { status: string } } })
        .store.subscription.status,
    ).toBe("expired");
    // Nothing was deleted.
    const stillThere = await f.as(A, (tx) =>
      tx.storeProduct.count({ where: { storeId: A.storeId } }),
    );
    expect(stillThere).toBeGreaterThan(0);
    // A device clock cannot help: the server reads its own time, whatever the request says.
    const past = await call(
      products.GET as Handler,
      A,
      "GET",
      "/api/products",
      undefined,
      "",
      {
        Date: "Mon, 01 Jan 2024 00:00:00 GMT",
        "X-Client-Time": "2024-01-01T00:00:00Z",
      },
    );
    expect(past.status).toBe(402);
    // Shop B is untouched by A's expiry.
    expect(
      (await call(products.GET as Handler, B, "GET", "/api/products")).status,
    ).toBe(200);
  });

  it("the offline outbox: an expired shop's queued sale is refused with SUBSCRIPTION_INACTIVE (kept by the client)", async () => {
    const r = await call(
      sales.POST as Handler,
      A,
      "POST",
      "/api/sales",
      {
        opId: crypto.randomUUID(),
        lines: [{ variantId, quantityBase: 1 }],
      },
      "",
      { "X-Hesba-Store-Id": A.storeId },
    );
    expect(r.status).toBe(402);
    expect((r.json.error as { code: string }).code).toBe(
      "SUBSCRIPTION_INACTIVE",
    );
    expect(
      await f.as(A, (tx) =>
        tx.sale.count({
          where: {
            storeId: A.storeId,
            saleLines: { some: { quantityBaseUnits: 1 } },
          },
        }),
      ),
    ).toBe(0);
  });

  it("Hesba activates a month by hand: the shop works again, the same account", async () => {
    const [row] = await f.sql<
      Array<{
        subscription_status: string;
        subscription_ends_at: Date;
        subscription_started_at: Date;
      }>
    >`
      SELECT * FROM hesba_renew_subscription(${A.storeId}::uuid, 1, 'monthly')`;
    expect(row!.subscription_status).toBe("active");
    const months =
      (row!.subscription_ends_at.getTime() -
        row!.subscription_started_at.getTime()) /
      86_400_000;
    expect(months).toBeGreaterThanOrEqual(28);
    expect(months).toBeLessThanOrEqual(31);
    expect(
      (await call(products.GET as Handler, A, "GET", "/api/products")).status,
    ).toBe(200);
    const s = await call(
      subscriptionRoute as Handler,
      A,
      "GET",
      "/api/subscription",
    );
    expect((s.json.subscription as { status: string }).status).toBe("active");
    // The change is in Hesba's audit.
    const events =
      await f.sql`SELECT new_status FROM store_subscription_events WHERE store_id = ${A.storeId}`;
    expect(events.length).toBeGreaterThan(0);
  });

  it("renewing an active subscription keeps the remaining days (3 months from the current end)", async () => {
    const end = new Date(Date.now() + 10 * 86_400_000);
    await f.sql`UPDATE stores SET subscription_ends_at = ${end} WHERE id = ${A.storeId}`;
    const [row] = await f.sql<Array<{ subscription_ends_at: Date }>>`
      SELECT * FROM hesba_renew_subscription(${A.storeId}::uuid, 3)`;
    // Postgres month arithmetic (a 30th + 3 months is the last day of February).
    const [want] = await f.sql<
      Array<{ e: Date }>
    >`SELECT ${end}::timestamptz + interval '3 months' AS e`;
    expect(row!.subscription_ends_at.getTime()).toBe(want!.e.getTime());
    expect(row!.subscription_ends_at.getTime()).toBeGreaterThan(
      end.getTime() + 80 * 86_400_000,
    );
  });

  it("a paid subscription stops at its end date; renewing an expired one counts from the renewal", async () => {
    await f.sql`UPDATE stores SET subscription_started_at = now() - interval '40 days', subscription_ends_at = now() - interval '1 second' WHERE id = ${A.storeId}`;
    expect(
      (await call(products.GET as Handler, A, "GET", "/api/products")).status,
    ).toBe(402);
    const before = Date.now();
    const [row] = await f.sql<
      Array<{ subscription_ends_at: Date; subscription_started_at: Date }>
    >`
      SELECT * FROM hesba_renew_subscription(${A.storeId}::uuid, 1)`;
    expect(row!.subscription_started_at.getTime()).toBeGreaterThanOrEqual(
      before - 5_000,
    );
    const expected = new Date(row!.subscription_started_at);
    expected.setUTCMonth(expected.getUTCMonth() + 1);
    expect(
      Math.abs(row!.subscription_ends_at.getTime() - expected.getTime()),
    ).toBeLessThan(2 * 3600_000);
    expect(
      (await call(products.GET as Handler, A, "GET", "/api/products")).status,
    ).toBe(200);
  });

  it("admin helpers: find a shop by its owner's phone; suspend keeps paid days for the next renewal", async () => {
    const [owner] = await f.sql<Array<{ phone: string }>>`
      SELECT u.phone FROM users u WHERE u.id = ${A.userId}`;
    const found = await f.sql<
      Array<{ store_id: string; subscription_status: string }>
    >`
      SELECT * FROM hesba_find_store(${owner!.phone})`;
    expect(found.map((x) => x.store_id)).toContain(A.storeId);
    const [before] = await f.sql<Array<{ subscription_ends_at: Date }>>`
      SELECT subscription_ends_at FROM stores WHERE id = ${A.storeId}`;
    await f.sql`SELECT * FROM hesba_set_subscription_status(${A.storeId}::uuid, 'suspended')`;
    expect(
      (await call(products.GET as Handler, A, "GET", "/api/products")).status,
    ).toBe(402);
    const [row] = await f.sql<Array<{ subscription_ends_at: Date }>>`
      SELECT * FROM hesba_renew_subscription(${A.storeId}::uuid, 1)`;
    const [want] = await f.sql<Array<{ e: Date }>>`
      SELECT ${before!.subscription_ends_at}::timestamptz + interval '1 month' AS e`;
    expect(row!.subscription_ends_at.getTime()).toBe(want!.e.getTime());
    expect(
      (await call(products.GET as Handler, A, "GET", "/api/products")).status,
    ).toBe(200);
    await expect(
      withTenant(
        A.storeId,
        A.userId,
        (tx) => tx.$queryRaw`SELECT * FROM hesba_find_store('x')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("an empty end date never means 'forever'; suspended stops the shop", async () => {
    await expect(
      f.sql`UPDATE stores SET subscription_status = 'active', subscription_ends_at = NULL WHERE id = ${B.storeId}`,
    ).rejects.toThrow(/stores_active_has_end_check/);
    await expect(
      f.sql`UPDATE stores SET subscription_status = 'trialing', trial_ends_at = NULL WHERE id = ${B.storeId}`,
    ).rejects.toThrow(/stores_trial_has_end_check/);
    await f.sql`UPDATE stores SET subscription_status = 'suspended' WHERE id = ${B.storeId}`;
    const r = await call(products.GET as Handler, B, "GET", "/api/products");
    expect(r.status).toBe(402);
    expect(
      (r.json.error as { details: { subscriptionStatus: string } }).details
        .subscriptionStatus,
    ).toBe("suspended");
    await f.sql`UPDATE stores SET subscription_status = 'trialing', trial_ends_at = now() + interval '1 day' WHERE id = ${B.storeId}`;
    expect(
      (await call(products.GET as Handler, B, "GET", "/api/products")).status,
    ).toBe(200);
  });

  it("logout works for an expired shop", async () => {
    await f.sql`UPDATE stores SET subscription_status = 'expired' WHERE id = ${B.storeId}`;
    const r = await call(logoutRoute as Handler, B, "POST", "/api/auth/logout");
    expect(r.status).toBeLessThan(300);
    tokens.delete(B.storeId);
    await f.sql`UPDATE stores SET subscription_status = 'trialing', trial_ends_at = now() + interval '1 day' WHERE id = ${B.storeId}`;
  });

  // ─── The daily sales total (إدارة المحل) ──────────────────────────────────
  it("daily total: cash into the drawer, a wallet part into its balance, once per opId; cancel gives it back", async () => {
    await setMode(A.storeId, "simple");
    const m = await machines.upsertMachine(A.storeId, A.userId, {
      name: "فودافون كاش",
      provider: "فودافون كاش",
    });
    await recordDrawerCount(A.storeId, A.userId, {
      opId: crypto.randomUUID(),
      countedPiasters: 50000,
    });
    const body = {
      opId: crypto.randomUUID(),
      cashPiasters: 120050,
      parts: [{ machineId: m.id, amountPiasters: 30000 }],
      note: "مبيعات اليوم",
    };
    const movementsBefore = await f.as(A, (tx) =>
      tx.stockMovement.count({ where: { storeId: A.storeId } }),
    );
    const r = await call(
      dailySales.POST as Handler,
      A,
      "POST",
      "/api/daily-sales",
      body,
    );
    expect(r.status).toBe(201);
    const entry = r.json.entry as { id: string; totalPiasters: number };
    expect(entry.totalPiasters).toBe(150050);
    const again = await call(
      dailySales.POST as Handler,
      A,
      "POST",
      "/api/daily-sales",
      body,
    );
    expect(again.status).toBe(200);
    const balance = async () =>
      (await machines.getStoreMachines(A.storeId, A.userId)).find(
        (x) => x.id === m.id,
      )!.currentBalancePiasters;
    expect(await balance()).toBe(30000);
    let d = await getDrawer(A.storeId, A.userId);
    expect(d.expectedPiasters).toBe(50000 + 120050);
    expect(d.flows.find((x) => x.key === "dailySales")?.amountPiasters).toBe(
      120050,
    );

    // The report counts it as revenue, by payment, with profit unknown (no cost per item).
    // إدارة المحل reads whole months (ADR-0036): this month, up to today.
    const day = toCairoDateString(new Date());
    const q = monthQuery(day.slice(0, 7), day);
    const rep = await call(
      reportRoute as Handler,
      A,
      "GET",
      `/api/reports/home?period=custom&from=${q.from}&to=${q.to}`,
    );
    expect(rep.status).toBe(200);
    const s = rep.json.sales as {
      revenuePiasters: number;
      grossProfitPiasters: number | null;
      dailyTotalsPiasters: number;
    };
    expect(s.dailyTotalsPiasters).toBe(150050);
    expect(s.grossProfitPiasters).toBeNull();
    const pay = rep.json.byPaymentMethod as { cash: number; wallet: number };
    expect(pay.wallet).toBeGreaterThanOrEqual(30000);

    // No stock moved: a daily total never claims which products were sold.
    const movementsAfter = await f.as(A, (tx) =>
      tx.stockMovement.count({ where: { storeId: A.storeId } }),
    );
    expect(movementsAfter).toBe(movementsBefore);

    const cancel = await call(
      dailyCancelRoute as Handler,
      A,
      "DELETE",
      `/api/daily-sales/${entry.id}`,
      undefined,
      entry.id,
    );
    expect(cancel.status).toBe(200);
    expect(await balance()).toBe(0);
    d = await getDrawer(A.storeId, A.userId);
    expect(d.expectedPiasters).toBe(50000);
    const kept = await f.as(A, (tx) =>
      tx.dailySalesEntry.findUniqueOrThrow({ where: { id: entry.id } }),
    );
    expect(kept.cancelledAt).not.toBeNull();
    const invalid = await call(
      dailySales.POST as Handler,
      A,
      "POST",
      "/api/daily-sales",
      { opId: crypto.randomUUID(), cashPiasters: 0 },
    );
    expect(invalid.status).toBe(400);
    // Another shop cannot put money into this shop's wallet.
    await setMode(B.storeId, "simple");
    const foreign = await call(
      dailySales.POST as Handler,
      B,
      "POST",
      "/api/daily-sales",
      {
        opId: crypto.randomUUID(),
        parts: [{ machineId: m.id, amountPiasters: 100 }],
      },
    );
    expect(foreign.status).toBe(404);
    expect(await balance()).toBe(0);
    await setMode(B.storeId, "pos");
  });

  it("the AI assistant counts إدارة المحل's daily totals as sales (same numbers as the reports)", async () => {
    await setMode(A.storeId, "simple");
    const tools = new BusinessToolsService(appPrisma);
    const ctx = { storeId: A.storeId, userId: A.userId, prisma: appPrisma };
    type Summary = {
      sales_total_piasters: number;
      paid_now_sales_piasters: number;
      daily_totals_piasters: number;
    };
    const before = (await tools.executeTool(
      "getSalesSummary",
      { period: "today" },
      ctx,
    )) as Summary;
    const r = await call(
      dailySales.POST as Handler,
      A,
      "POST",
      "/api/daily-sales",
      { opId: crypto.randomUUID(), cashPiasters: 123400 },
    );
    expect(r.status).toBe(201);
    const after = (await tools.executeTool(
      "getSalesSummary",
      { period: "today" },
      ctx,
    )) as Summary;
    expect(after.daily_totals_piasters - before.daily_totals_piasters).toBe(
      123400,
    );
    expect(after.sales_total_piasters - before.sales_total_piasters).toBe(
      123400,
    );
    expect(after.paid_now_sales_piasters - before.paid_now_sales_piasters).toBe(
      123400,
    );
    const overview = (await tools.executeTool(
      "getFinancialOverview",
      { period: "today" },
      ctx,
    )) as { gross_profit_piasters: number | null; note: string };
    // A daily total has no cost per item: profit is unknown, never guessed — and the note says why.
    expect(overview.gross_profit_piasters).toBeNull();
    expect(overview.note).toContain("إجمالي يومي");
    await setMode(A.storeId, "pos");
  });
});
