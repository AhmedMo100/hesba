/**
 * AI product scanner and its credits (ADR-0030) on real Postgres with the app role (FORCE RLS).
 * The model is the deterministic mock (no photo leaves the machine); everything else is real:
 * catalog matching against the shop's products, per-shop daily / monthly / bonus credits in
 * Cairo days, idempotent retries, no credit for any failure, platform limits, the circuit
 * breaker, the budget, and shop isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { createSession } from "@/server/modules/auth";
import {
  ScannerService,
  invalidateAiSettingsCache,
  SCAN_DAILY_LIMIT_MESSAGE,
  SCAN_MONTHLY_LIMIT_MESSAGE,
  AI_GLOBAL_UNAVAILABLE_MESSAGE,
  SCANNER_DISABLED_MESSAGE,
} from "@/server/modules/ai";
import {
  MockVisionProvider,
  ProviderError,
  type MockVisionScript,
  type ScanImage,
} from "@/server/infra/ai";
import { POST as scanRoute } from "@/app/api/ai/scan/route";
import { AppError } from "@/server/platform/error";
import { SaleFixtures } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const A = f.shopA;
const B = f.shopB;

const JPEG: ScanImage = {
  mimeType: "image/jpeg",
  data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
};
const img = (n = 1) => Array.from({ length: n }, () => JPEG);

const pepsi = (imageIndex = 0, quantity = 2, extra = {}) => ({
  imageIndex,
  brand: "Pepsi",
  nameAr: "بيبسي",
  nameEn: "Pepsi",
  sizeValue: 330,
  sizeUnit: "ml",
  packaging: "can",
  quantity,
  confidence: 0.93,
  ...extra,
});

const svc = (script?: MockVisionScript | MockVisionScript[]) => {
  const vision = new MockVisionProvider(script);
  return { s: new ScannerService(appPrisma, vision), vision };
};

async function settings(data: Record<string, unknown>) {
  await f.sql`UPDATE ai_platform_settings SET ${f.sql(data)} WHERE id = 1`;
  invalidateAiSettingsCache();
}
const DEFAULTS = {
  scanner_enabled: true,
  scanner_daily_default: 10,
  scanner_monthly_default: 200,
  scanner_max_images: 6,
  scanner_rpm: 10000,
  scanner_max_concurrent: 100,
  shop_rpm: 1000,
  monthly_budget_micros: 0,
  scanner_cost_estimate_micros: 0,
  breaker_failure_threshold: 5,
  breaker_cooldown_seconds: 60,
};
let saved: Record<string, unknown> = {};

async function quota(shop: typeof A, data: Record<string, unknown>) {
  await f.sql`INSERT INTO ai_scanner_shop_quotas (store_id) VALUES (${shop.storeId}::uuid)
              ON CONFLICT (store_id) DO NOTHING`;
  await f.sql`UPDATE ai_scanner_shop_quotas SET ${f.sql(data)} WHERE store_id = ${shop.storeId}::uuid`;
}
const resetShop = async (shop: typeof A) => {
  await f.sql`DELETE FROM ai_scan_operations WHERE store_id = ${shop.storeId}::uuid`;
  await f.sql`DELETE FROM ai_scanner_shop_quotas WHERE store_id = ${shop.storeId}::uuid`;
};
const opsOf = (shop: typeof A) =>
  f.sql<Array<{ status: string; error_category: string | null }>>`
    SELECT status, error_category FROM ai_scan_operations
     WHERE store_id = ${shop.storeId}::uuid ORDER BY created_at`;

async function expectAppError(
  p: Promise<unknown>,
  status: number,
  message?: string,
) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).statusCode).toBe(status);
  if (message) expect((err as AppError).message).toBe(message);
  return err as AppError;
}

let can330: { variantId: string };
let bottle1l: { variantId: string };
let chipsyCheese: { variantId: string };
let chipsyChili: { variantId: string };

beforeAll(async () => {
  await f.setup();
  const [row] = await f.sql`SELECT * FROM ai_platform_settings WHERE id = 1`;
  saved = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, row![k]]));
  await settings(DEFAULTS);
  can330 = await f.product(A, { name: "بيبسي كانز 330 مل", sell: 1500 });
  bottle1l = await f.product(A, { name: "بيبسي 1 لتر", sell: 3000 });
  chipsyCheese = await f.product(A, { name: "شيبسي جبنة", sell: 1000 });
  chipsyChili = await f.product(A, { name: "شيبسي شطة", sell: 1000 });
  await f.addStock(A, can330.variantId, 24);
  await f.addStock(A, chipsyCheese.variantId, 5);
});

afterAll(async () => {
  await settings(saved);
  await f.sql`DELETE FROM ai_provider_health`;
  await f.sql`DELETE FROM ai_inflight`;
  await f.teardown();
});

beforeEach(async () => {
  await resetShop(A);
  await resetShop(B);
  await settings(DEFAULTS);
  await f.sql`DELETE FROM ai_provider_health`;
  await f.sql`DELETE FROM ai_inflight`;
  await f.sql`DELETE FROM ai_capacity_minutes`;
});

describe("recognition and catalog matching", () => {
  it("one photo, several products: confident → matched; unsure → uncertain; unreadable → unmatched; data from the database", async () => {
    const moves = async () =>
      Number(
        (
          await f.sql`SELECT count(*)::int AS m FROM stock_movements WHERE store_id = ${A.storeId}::uuid`
        )[0]!.m,
      );
    const before = await moves();
    const { s } = svc();
    const r = await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    expect(r.duplicate).toBe(false);
    expect(r.provider).toBe("mock");
    const [cola, chips, unknown] = r.lines;
    expect(cola!.status).toBe("matched");
    expect(cola!.quantity).toBe(2);
    expect(cola!.candidates[0]!.variantId).toBe(can330.variantId);
    // Price and stock are the shop's, not the model's.
    expect(cola!.candidates[0]!.sellPricePiasters).toBe(1500);
    expect(cola!.candidates[0]!.stockBase).toBe(24);
    // The 1 L bottle conflicts on size and is never offered for a 330 ml can.
    expect(cola!.candidates.map((c) => c.variantId)).not.toContain(
      bottle1l.variantId,
    );
    // Chipsy cheese, but the model is unsure: the user must confirm; chili is excluded.
    expect(chips!.status).toBe("uncertain");
    expect(chips!.candidates[0]!.variantId).toBe(chipsyCheese.variantId);
    // Chili may be offered only as a weaker alternative, never first.
    const chili = chips!.candidates.find(
      (c) => c.variantId === chipsyChili.variantId,
    );
    if (chili)
      expect(chili.score).toBeLessThan(chips!.candidates[0]!.score - 0.2);
    expect(unknown!.status).toBe("unmatched");
    expect(unknown!.candidates).toEqual([]);
    expect(r.quota.usedToday).toBe(1);
    // Nothing was created or sold: no new product, no stock movement.
    const [row] =
      await f.sql`SELECT count(*)::int AS n FROM store_products WHERE store_id = ${A.storeId}::uuid`;
    expect(row!.n).toBe(4);
    expect(await moves()).toBe(before);
  });

  it("several photos: the same product in two photos is one line with both quantities; sizes and flavors stay distinct", async () => {
    const { s, vision } = svc({
      kind: "items",
      items: [
        pepsi(0, 2),
        pepsi(1, 3),
        pepsi(1, 1, { sizeValue: 1, sizeUnit: "l", packaging: "bottle" }),
        {
          imageIndex: 2,
          brand: "Chipsy",
          nameAr: "شيبسي",
          flavor: "شطة",
          quantity: 4,
          confidence: 0.9,
        },
        // A product in a photo that was not sent is dropped (untrusted output).
        pepsi(7, 9),
      ],
    });
    const r = await s.scan(A.storeId, A.userId, crypto.randomUUID(), img(3));
    expect(vision.lastImageCount).toBe(3);
    const byVariant = new Map(
      r.lines.map((l) => [l.candidates[0]?.variantId, l]),
    );
    expect(byVariant.get(can330.variantId)!.quantity).toBe(5);
    expect(byVariant.get(can330.variantId)!.imageIndexes).toEqual([0, 1]);
    expect(byVariant.get(bottle1l.variantId)!.quantity).toBe(1);
    expect(byVariant.get(chipsyChili.variantId)!.quantity).toBe(4);
    expect(r.lines).toHaveLength(3);
  });

  it("a product the shop does not have is unmatched (never invented)", async () => {
    const { s } = svc({
      kind: "items",
      items: [
        {
          imageIndex: 0,
          brand: "Juhayna",
          nameAr: "لبن جهينة",
          sizeValue: 1,
          sizeUnit: "l",
          quantity: 1,
          confidence: 0.97,
        },
      ],
    });
    const r = await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    expect(r.lines[0]!.status).toBe("unmatched");
    expect(r.lines[0]!.candidates).toEqual([]);
  });
});

describe("credits: only a valid answer counts", () => {
  it("a retry with the same opId returns the first result without calling the model or taking a credit", async () => {
    const { s, vision } = svc();
    const opId = crypto.randomUUID();
    const first = await s.scan(A.storeId, A.userId, opId, img());
    const again = await s.scan(A.storeId, A.userId, opId, img());
    expect(again.duplicate).toBe(true);
    expect(again.scanId).toBe(first.scanId);
    expect(vision.calls).toBe(1);
    expect(again.quota.usedToday).toBe(1);
  });

  it("invalid output, malformed JSON, timeout, 429 and 5xx take no credit; the same opId then succeeds once", async () => {
    const opId = crypto.randomUUID();
    const failures: MockVisionScript[] = [
      { kind: "raw", raw: { items: [{ imageIndex: "x", quantity: -1 }] } },
      { kind: "raw", raw: "not json at all" },
      { kind: "error", error: new ProviderError("invalid_output") },
      { kind: "error", error: new ProviderError("timeout") },
      { kind: "error", error: new ProviderError("rate_limited", 429, 30) },
      { kind: "error", error: new ProviderError("unavailable", 503, 30) },
    ];
    for (const script of failures) {
      const { s } = svc(script);
      await expectAppError(
        s.scan(A.storeId, A.userId, opId, img()),
        script.kind === "raw" ? 503 : 503,
      );
      expect((await s.getQuota(A.storeId)).usedToday).toBe(0);
    }
    const { s } = svc();
    const ok = await s.scan(A.storeId, A.userId, opId, img());
    expect(ok.quota.usedToday).toBe(1);
    expect((await opsOf(A)).map((o) => o.status)).toEqual(["succeeded"]);
  });

  it("a brief provider failure is retried once inside the request (bounded)", async () => {
    const { s, vision } = svc([
      { kind: "error", error: new ProviderError("unavailable", 503, 0) },
      { kind: "items", items: [pepsi()] },
    ]);
    const r = await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    expect(vision.calls).toBe(2);
    expect(r.lines[0]!.status).toBe("matched");

    const { s: s2, vision: v2 } = svc({
      kind: "error",
      error: new ProviderError("unavailable", 503, 0),
    });
    await expectAppError(
      s2.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      AI_GLOBAL_UNAVAILABLE_MESSAGE,
    );
    expect(v2.calls).toBe(2); // never more
  });

  it("too many photos is refused before anything is reserved", async () => {
    await settings({ scanner_max_images: 2 });
    const { s, vision } = svc();
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img(3)),
      400,
    );
    expect(vision.calls).toBe(0);
    expect(await opsOf(A)).toEqual([]);
  });
});

describe("daily / monthly limits in Cairo time, overrides, bonus credits", () => {
  // 2026-11-20 23:30 Cairo (UTC+2) and 00:30 the next Cairo day.
  const lateNight = new Date("2026-11-20T21:30:00Z");
  const lateNight2 = new Date("2026-11-20T21:50:00Z");
  const nextDay = new Date("2026-11-20T22:30:00Z");

  it("the daily limit stops at the limit and resets at Cairo midnight (not UTC)", async () => {
    await quota(A, { daily_limit: 1 });
    const { s } = svc();
    await s.scan(A.storeId, A.userId, crypto.randomUUID(), img(), lateNight);
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img(), lateNight2),
      429,
      SCAN_DAILY_LIMIT_MESSAGE,
    );
    // Still 2026-11-20 in UTC, but already the 21st in Cairo: a new day.
    const r = await s.scan(
      A.storeId,
      A.userId,
      crypto.randomUUID(),
      img(),
      nextDay,
    );
    expect(r.quota.usedToday).toBe(1);
  });

  it("the monthly limit stops across days and resets on the Cairo month", async () => {
    await quota(A, { monthly_limit: 2 });
    const { s } = svc();
    await s.scan(
      A.storeId,
      A.userId,
      crypto.randomUUID(),
      img(),
      new Date("2026-11-10T10:00:00Z"),
    );
    await s.scan(
      A.storeId,
      A.userId,
      crypto.randomUUID(),
      img(),
      new Date("2026-11-15T10:00:00Z"),
    );
    await expectAppError(
      s.scan(
        A.storeId,
        A.userId,
        crypto.randomUUID(),
        img(),
        new Date("2026-11-30T21:00:00Z"),
      ),
      429,
      SCAN_MONTHLY_LIMIT_MESSAGE,
    );
    // 2026-11-30 22:30 UTC is 1 December in Cairo.
    const r = await s.scan(
      A.storeId,
      A.userId,
      crypto.randomUUID(),
      img(),
      new Date("2026-11-30T22:30:00Z"),
    );
    expect(r.quota.usedThisMonth).toBe(1);
  });

  it("the platform default applies without an override; a default change applies at once", async () => {
    await settings({ scanner_daily_default: 1 });
    const { s } = svc();
    expect((await s.getQuota(A.storeId)).dailyLimit).toBe(1);
    await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      429,
      SCAN_DAILY_LIMIT_MESSAGE,
    );
    await settings({ scanner_daily_default: 3 });
    await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    // A shop override wins over the default.
    await quota(A, { daily_limit: 5 });
    expect((await s.getQuota(A.storeId)).dailyLimit).toBe(5);
  });

  it("bonus credits are used once a limit is reached, and only on success", async () => {
    await quota(A, { daily_limit: 0, bonus_credits: 1 });
    const { s: bad } = svc({
      kind: "error",
      error: new ProviderError("invalid_output"),
    });
    await expectAppError(
      bad.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
    );
    expect((await bad.getQuota(A.storeId)).bonusCredits).toBe(1);
    const { s } = svc();
    const r = await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    expect(r.quota.bonusCredits).toBe(0);
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      429,
      SCAN_DAILY_LIMIT_MESSAGE,
    );
  });

  it("parallel scans cannot go past the limit", async () => {
    await quota(A, { daily_limit: 1 });
    const { s } = svc();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await s.getQuota(A.storeId)).usedToday).toBe(1);
  });

  it("changing the provider (a new key or model) keeps the shop's usage and limits", async () => {
    await quota(A, { daily_limit: 2 });
    await svc().s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    class OtherProvider extends MockVisionProvider {
      override readonly name = "mock";
      override readonly model: string = "another-model";
    }
    const other = new ScannerService(appPrisma, new OtherProvider());
    const q = await other.getQuota(A.storeId);
    expect(q.usedToday).toBe(1);
    expect(q.dailyLimit).toBe(2);
  });
});

describe("switches, platform limits, breaker, budget", () => {
  it("scanner off for the platform or for one shop: the clear message, nothing counted", async () => {
    await settings({ scanner_enabled: false });
    await expectAppError(
      svc().s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      SCANNER_DISABLED_MESSAGE,
    );
    await settings({ scanner_enabled: true });
    await quota(A, { enabled: false });
    await expectAppError(
      svc().s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      SCANNER_DISABLED_MESSAGE,
    );
    // Another shop is not affected.
    await svc().s.scan(B.storeId, B.userId, crypto.randomUUID(), img());
    expect((await opsOf(A)).length).toBe(0);
  });

  it("platform requests/minute exhausted: the global message, the provider is not called, no credit", async () => {
    await settings({ scanner_rpm: 0 });
    const { s, vision } = svc();
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      AI_GLOBAL_UNAVAILABLE_MESSAGE,
    );
    expect(vision.calls).toBe(0);
    expect((await s.getQuota(A.storeId)).usedToday).toBe(0);
    const [ev] =
      await f.sql`SELECT status, error_category FROM ai_usage_events WHERE store_id = ${A.storeId}::uuid ORDER BY created_at DESC LIMIT 1`;
    expect(ev).toMatchObject({
      status: "rejected",
      error_category: "global_rpm",
    });
  });

  it("one shop cannot take all platform capacity: per-shop requests/minute", async () => {
    await settings({ shop_rpm: 2 });
    const { s } = svc();
    await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    await s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      429,
    );
    // Shop B still gets served.
    await svc().s.scan(B.storeId, B.userId, crypto.randomUUID(), img());
  });

  it("repeated provider failures open the breaker (no more calls), and it recovers by itself", async () => {
    await settings({ breaker_failure_threshold: 2 });
    const { s, vision } = svc({
      kind: "error",
      error: new ProviderError("unavailable", 503, 30),
    });
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
    );
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
    );
    const callsBefore = vision.calls;
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      AI_GLOBAL_UNAVAILABLE_MESSAGE,
    );
    expect(vision.calls).toBe(callsBefore); // refused before the provider
    // Cool-down over: the next request goes through and closes the breaker.
    await f.sql`UPDATE ai_provider_health SET open_until = now() - interval '1 second' WHERE feature = 'scanner'`;
    const r = await svc().s.scan(
      A.storeId,
      A.userId,
      crypto.randomUUID(),
      img(),
    );
    expect(r.lines.length).toBeGreaterThan(0);
    const [h] =
      await f.sql`SELECT consecutive_failures, open_until FROM ai_provider_health WHERE feature = 'scanner'`;
    expect(h).toMatchObject({ consecutive_failures: 0, open_until: null });
    expect((await svc().s.getQuota(A.storeId)).usedToday).toBe(1);
  });

  it("an exhausted provider quota or a bad key stops calls at once (no retry storm)", async () => {
    const { s, vision } = svc({
      kind: "error",
      error: new ProviderError("provider_quota", 429, 120),
    });
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      AI_GLOBAL_UNAVAILABLE_MESSAGE,
    );
    expect(vision.calls).toBe(1);
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img()),
      503,
      AI_GLOBAL_UNAVAILABLE_MESSAGE,
    );
    expect(vision.calls).toBe(1);
  });

  it("the monthly spending cap is never exceeded; nothing raises it automatically", async () => {
    const month = "2026-11-01";
    await f.sql`DELETE FROM ai_budget_months WHERE month >= ${month}::date`;
    await settings({
      monthly_budget_micros: 150,
      scanner_cost_estimate_micros: 100,
    });
    const now = new Date("2026-11-21T10:00:00Z");
    const { s } = svc();
    await s.scan(A.storeId, A.userId, crypto.randomUUID(), img(), now);
    await expectAppError(
      s.scan(A.storeId, A.userId, crypto.randomUUID(), img(), now),
      503,
      AI_GLOBAL_UNAVAILABLE_MESSAGE,
    );
    const [b] =
      await f.sql`SELECT reserved_micros::int AS r, spent_micros::int AS sp FROM ai_budget_months WHERE month = ${month}::date`;
    expect(b).toEqual({ r: 0, sp: 100 });
    const [st] =
      await f.sql`SELECT monthly_budget_micros::int AS cap FROM ai_platform_settings WHERE id = 1`;
    expect(st!.cap).toBe(150);
    await f.sql`DELETE FROM ai_budget_months WHERE month >= ${month}::date`;
  });
});

describe("shop isolation and the HTTP route", () => {
  it("a shop sees only its own scans and credits; it cannot change another shop's quota", async () => {
    await svc().s.scan(A.storeId, A.userId, crypto.randomUUID(), img());
    await quota(A, { daily_limit: 3 });
    expect((await svc().s.getQuota(B.storeId)).usedToday).toBe(0);
    const seen = await withTenant(
      B.storeId,
      B.userId,
      async (tx) => ({
        ops: await tx.aiScanOperation.count({ where: { storeId: A.storeId } }),
        quotas: await tx.aiScannerShopQuota.count({
          where: { storeId: A.storeId },
        }),
        events: await tx.aiUsageEvent.count({ where: { storeId: A.storeId } }),
        changed: (
          await tx.aiScannerShopQuota.updateMany({
            where: { storeId: A.storeId },
            data: { dailyLimit: 9999, bonusCredits: 9999 },
          })
        ).count,
      }),
      appPrisma,
    );
    expect(seen).toEqual({ ops: 0, quotas: 0, events: 0, changed: 0 });
    const [q] =
      await f.sql`SELECT daily_limit, bonus_credits FROM ai_scanner_shop_quotas WHERE store_id = ${A.storeId}::uuid`;
    expect(q).toEqual({ daily_limit: 3, bonus_credits: 0 });
    // A shop cannot raise platform settings either.
    const raised = await withTenant(
      B.storeId,
      B.userId,
      (tx) =>
        tx.aiPlatformSettings.updateMany({
          data: { scannerDailyDefault: 9999 },
        }),
      appPrisma,
    );
    expect(raised.count).toBe(0);
  });

  it("the route checks the session, the real file type and the op id; a refused upload reserves nothing", async () => {
    const token = (await createSession(A.userId, A.storeId)).rawToken;
    const post = async (body: unknown, cookie = `hesba_session=${token}`) => {
      const res = await scanRoute(
        new Request("http://localhost:3000/api/ai/scan", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      return {
        status: res.status,
        json: (await res.json()) as Record<string, unknown>,
      };
    };
    const form = (
      files: Array<[Uint8Array, string]>,
      opId: string = crypto.randomUUID(),
    ) => ({
      opId,
      images: files.map(([bytes]) => ({
        data: Buffer.from(bytes).toString("base64"),
      })),
    });
    expect((await post(form([[JPEG.data, "image/jpeg"]]), "")).status).toBe(
      401,
    );
    // Says it is a JPEG but is not one.
    const fake = await post(
      form([[new TextEncoder().encode("<svg>"), "image/jpeg"]]),
    );
    expect(fake.status).toBe(400);
    expect(
      (await post(form([[JPEG.data, "image/jpeg"]], "not-a-uuid"))).status,
    ).toBe(400);
    expect(await opsOf(A)).toEqual([]);
    const ok = await post(form([[JPEG.data, "image/jpeg"]]));
    expect(ok.status).toBe(201);
    expect((ok.json.lines as unknown[]).length).toBeGreaterThan(0);
  });
});
