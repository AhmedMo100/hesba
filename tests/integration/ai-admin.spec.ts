/**
 * Platform admin for AI (ADR-0030), real Postgres, app role: only a user listed in
 * `platform_admins` (staff SQL) can monitor usage and change limits; every change is audited;
 * a shop owner gets 403 — and sees nothing even if they set the admin flag on the connection.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma as appPrisma } from "@/server/infra/db/client";
import { createSession } from "@/server/modules/auth";
import { invalidateAiSettingsCache, ScannerService } from "@/server/modules/ai";
import { MockVisionProvider } from "@/server/infra/ai";
import { GET as overviewRoute } from "@/app/api/admin/ai/route";
import { POST as settingsRoute } from "@/app/api/admin/ai/settings/route";
import { GET as shopsRoute } from "@/app/api/admin/ai/shops/route";
import { POST as shopRoute } from "@/app/api/admin/ai/shops/[storeId]/route";
import { GET as meRoute } from "@/app/api/admin/me/route";
import { SaleFixtures, type Json } from "./helpers/sale-fixtures";

const f = new SaleFixtures();
const ADMIN = f.shopA; // the admin also owns a shop (their own account)
const OWNER = f.shopB;
const tokens = new Map<string, string>();

async function call(
  who: typeof ADMIN,
  handler: (req: Request, ctx: never) => Promise<Response>,
  path: string,
  body?: unknown,
  ctx?: unknown,
): Promise<{ status: number; json: Json }> {
  let token = tokens.get(who.userId);
  if (!token) {
    token = (await createSession(who.userId, who.storeId)).rawToken;
    tokens.set(who.userId, token);
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

let savedDaily = 10;

beforeAll(async () => {
  await f.setup();
  await f.sql`INSERT INTO platform_admins (user_id, note) VALUES (${ADMIN.userId}::uuid, 'test')`;
  const [s] =
    await f.sql`SELECT scanner_daily_default FROM ai_platform_settings WHERE id = 1`;
  savedDaily = s!.scanner_daily_default as number;
  await f.sql`UPDATE ai_platform_settings SET scanner_rpm = 10000, shop_rpm = 1000 WHERE id = 1`;
  await f.sql`DELETE FROM ai_provider_health`;
  await f.sql`DELETE FROM ai_capacity_minutes`;
  invalidateAiSettingsCache();
  // Some real usage to monitor: one scan by the shop owner.
  await new ScannerService(appPrisma, new MockVisionProvider()).scan(
    OWNER.storeId,
    OWNER.userId,
    crypto.randomUUID(),
    [{ mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) }],
  );
});

afterAll(async () => {
  await f.sql`UPDATE ai_platform_settings SET scanner_daily_default = ${savedDaily}, scanner_rpm = 10, shop_rpm = 3 WHERE id = 1`;
  invalidateAiSettingsCache();
  await f.sql`DELETE FROM ai_admin_audit WHERE admin_user_id = ${ADMIN.userId}::uuid`;
  await f.sql`DELETE FROM platform_admins WHERE user_id = ${ADMIN.userId}::uuid`;
  await f.teardown();
});

describe("platform admin: access", () => {
  it("a shop owner gets 403 on every admin endpoint; /api/admin/me says who is admin", async () => {
    expect(
      (await call(OWNER, meRoute as never, "/api/admin/me")).json.isAdmin,
    ).toBe(false);
    expect(
      (await call(ADMIN, meRoute as never, "/api/admin/me")).json.isAdmin,
    ).toBe(true);
    expect(
      (await call(OWNER, overviewRoute as never, "/api/admin/ai")).status,
    ).toBe(403);
    expect(
      (await call(OWNER, shopsRoute as never, "/api/admin/ai/shops")).status,
    ).toBe(403);
    expect(
      (
        await call(OWNER, settingsRoute as never, "/api/admin/ai/settings", {
          scannerDailyDefault: 999,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          OWNER,
          shopRoute as never,
          `/api/admin/ai/shops/${OWNER.storeId}`,
          { grantBonusCredits: 50 },
          {
            params: Promise.resolve({ storeId: OWNER.storeId }),
          },
        )
      ).status,
    ).toBe(403);
  });

  it("at the database level, the admin flag alone opens nothing for a non-admin", async () => {
    const seen = await appPrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${OWNER.userId}, true), set_config('app.platform_admin', 'on', true)`;
      return {
        // Their own shop stays visible (user_store_access); no other shop is.
        stores: await tx.store.count({ where: { id: { not: OWNER.storeId } } }),
        events: await tx.aiUsageEvent.count(),
        quotas: await tx.aiScannerShopQuota.updateMany({
          data: { bonusCredits: 999 },
        }),
        settings: await tx.aiPlatformSettings.updateMany({
          data: { scannerDailyDefault: 999 },
        }),
      };
    });
    expect(seen).toEqual({
      stores: 0,
      events: 0,
      quotas: { count: 0 },
      settings: { count: 0 },
    });
  });
});

describe("platform admin: monitoring and controls", () => {
  it("the overview shows today's usage across shops, limits, budget and provider status", async () => {
    const { status, json } = await call(
      ADMIN,
      overviewRoute as never,
      "/api/admin/ai",
    );
    expect(status).toBe(200);
    const today = json.today as Json;
    expect(today.scanner).toBeGreaterThanOrEqual(1);
    expect(
      (json.topShops as Json[]).some((s) => s.storeId === OWNER.storeId),
    ).toBe(true);
    expect(json.settings).toMatchObject({ scannerRpm: 10000 });
    expect(json.budget).toHaveProperty("remainingMicros");
    expect(json.providers).toHaveProperty("scanner");
    // No keys or prompts anywhere in the answer.
    expect(JSON.stringify(json)).not.toMatch(/api[_-]?key|AIza/i);
  });

  it("lists shops with their quota and usage; overrides, a switch-off and a bonus grant are audited", async () => {
    const list = await call(
      ADMIN,
      shopsRoute as never,
      `/api/admin/ai/shops?q=${OWNER.storeId}`,
    );
    const shop = (list.json.shops as Json[])[0]!;
    expect(shop).toMatchObject({
      storeId: OWNER.storeId,
      usedToday: 1,
      dailyOverride: null,
    });

    const ctx = { params: Promise.resolve({ storeId: OWNER.storeId }) };
    const r1 = await call(
      ADMIN,
      shopRoute as never,
      `/api/admin/ai/shops/${OWNER.storeId}`,
      { dailyLimit: 3, monthlyLimit: 40, reason: "تجربة" },
      ctx,
    );
    expect(r1.status).toBe(200);
    const r2 = await call(
      ADMIN,
      shopRoute as never,
      `/api/admin/ai/shops/${OWNER.storeId}`,
      { grantBonusCredits: 5 },
      { params: Promise.resolve({ storeId: OWNER.storeId }) },
    );
    const r3 = await call(
      ADMIN,
      shopRoute as never,
      `/api/admin/ai/shops/${OWNER.storeId}`,
      { grantBonusCredits: 2, enabled: false },
      { params: Promise.resolve({ storeId: OWNER.storeId }) },
    );
    expect(r2.json.quota).toMatchObject({ bonusCredits: 5 });
    expect(r3.json.quota).toMatchObject({
      bonusCredits: 7,
      enabled: false,
      dailyLimit: 3,
      monthlyLimit: 40,
    });

    // The shop sees the new limits at once (no deployment).
    const q = await new ScannerService(
      appPrisma,
      new MockVisionProvider(),
    ).getQuota(OWNER.storeId);
    expect(q).toMatchObject({
      dailyLimit: 3,
      monthlyLimit: 40,
      enabled: false,
      disabledReason: "shop",
      bonusCredits: 7,
    });

    const audit =
      await f.sql`SELECT action, previous_value, new_value, reason, admin_user_id::text AS admin
                                FROM ai_admin_audit WHERE target_store_id = ${OWNER.storeId}::uuid ORDER BY created_at`;
    expect(audit.map((a) => a.action)).toEqual([
      "shop_quota_update",
      "shop_quota_update_and_grant",
      "shop_quota_update_and_grant",
    ]);
    expect(audit[0]).toMatchObject({ reason: "تجربة", admin: ADMIN.userId });
    expect(audit[2]!.previous_value).toMatchObject({
      bonusCredits: 5,
      enabled: true,
    });
    expect(audit[2]!.new_value).toMatchObject({
      bonusCredits: 7,
      enabled: false,
    });

    // Invalid values are refused; an unknown shop is 404.
    expect(
      (
        await call(
          ADMIN,
          shopRoute as never,
          `/api/admin/ai/shops/${OWNER.storeId}`,
          { dailyLimit: -1 },
          { params: Promise.resolve({ storeId: OWNER.storeId }) },
        )
      ).status,
    ).toBe(400);
    const ghost = crypto.randomUUID();
    expect(
      (
        await call(
          ADMIN,
          shopRoute as never,
          `/api/admin/ai/shops/${ghost}`,
          { dailyLimit: 1 },
          { params: Promise.resolve({ storeId: ghost }) },
        )
      ).status,
    ).toBe(404);
  });

  it("global settings change at once and are audited with old and new values", async () => {
    const r = await call(
      ADMIN,
      settingsRoute as never,
      "/api/admin/ai/settings",
      {
        scannerDailyDefault: 7,
        reason: "حد يومي جديد",
      },
    );
    expect(r.status).toBe(200);
    expect((r.json.settings as Json).scannerDailyDefault).toBe(7);
    const q = await new ScannerService(
      appPrisma,
      new MockVisionProvider(),
    ).getQuota(ADMIN.storeId);
    expect(q.dailyLimit).toBe(7);
    const [a] =
      await f.sql`SELECT previous_value, new_value, reason FROM ai_admin_audit
                             WHERE action = 'settings_update' AND admin_user_id = ${ADMIN.userId}::uuid
                             ORDER BY created_at DESC LIMIT 1`;
    expect(a).toMatchObject({
      previous_value: { scannerDailyDefault: savedDaily },
      new_value: { scannerDailyDefault: 7 },
      reason: "حد يومي جديد",
    });
    expect(
      (
        await call(ADMIN, settingsRoute as never, "/api/admin/ai/settings", {
          shopRpm: 0,
        })
      ).status,
    ).toBe(400);
  });
});
