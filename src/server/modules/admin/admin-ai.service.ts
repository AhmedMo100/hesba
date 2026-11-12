import "server-only";

/**
 * @file admin-ai.service.ts
 * @description Platform-admin monitoring and controls for AI (ADR-0030): usage overview,
 * global limits and switches, per-shop scanner quotas and bonus grants, and the audit log.
 *
 * Authorization is checked twice: `requirePlatformAdmin` (the session's user must be in
 * `platform_admins`), and inside Postgres, where every cross-shop read or write runs in a
 * transaction flagged `app.platform_admin = 'on'` that the RLS policies accept ONLY for a user
 * listed in `platform_admins` (`hesba_is_platform_admin()`). A shop owner who is not listed
 * gets 403 here and sees nothing at the database level even if this check were skipped.
 *
 * Nothing here can change a shop's sales, stock, money or people data: the admin policies
 * cover the AI tables and a read of `stores` (id, name) only.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
import { AppError } from "@/server/platform/error";
import { requireSession, type SessionContext } from "@/server/modules/auth";
import {
  defaultVisionProvider,
  invalidateAiSettingsCache,
  loadAiSettings,
  cairoMonthDate,
  assistantProviderInfo,
} from "@/server/modules/ai";
import {
  cairoDayStartUtc,
  toCairoDateString,
  addDaysToDateKey,
} from "@/domain/time";
import type { AiSettingsPatch, ShopQuotaPatch } from "@/schemas/admin-ai";

type Tx = Prisma.TransactionClient;

/** Runs `fn` with the platform-admin database flag, after proving the user is an admin. */
export async function withPlatformAdmin<T>(
  userId: string,
  fn: (tx: Tx) => Promise<T>,
  db: PrismaClient = defaultPrisma,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true), set_config('app.platform_admin', 'on', true)`;
      const [row] = await tx.$queryRaw<
        Array<{ ok: boolean }>
      >`SELECT hesba_is_platform_admin() AS ok`;
      if (!row?.ok) throw AppError.forbidden("الصفحة دي لإدارة حسبة بس");
      return fn(tx);
    },
    { maxWait: 15_000, timeout: 20_000 },
  );
}

/** Whether this user is a platform admin (their own `platform_admins` row). */
export async function isPlatformAdmin(
  userId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return (await tx.platformAdmin.count({ where: { userId } })) > 0;
  });
}

/** The session, and a 403 unless its user is a platform admin. */
export async function requirePlatformAdmin(
  req: Request,
): Promise<SessionContext> {
  const context = await requireSession(req);
  if (!(await isPlatformAdmin(context.user.id))) {
    throw AppError.forbidden("الصفحة دي لإدارة حسبة بس");
  }
  return context;
}

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

function settingsView(s: Awaited<ReturnType<typeof loadAiSettings>>) {
  return {
    scannerEnabled: s.scannerEnabled,
    assistantEnabled: s.assistantEnabled,
    scannerDailyDefault: s.scannerDailyDefault,
    scannerMonthlyDefault: s.scannerMonthlyDefault,
    scannerMaxImages: s.scannerMaxImages,
    scannerRpm: s.scannerRpm,
    assistantRpm: s.assistantRpm,
    scannerMaxConcurrent: s.scannerMaxConcurrent,
    assistantMaxConcurrent: s.assistantMaxConcurrent,
    shopRpm: s.shopRpm,
    monthlyBudgetMicros: num(s.monthlyBudgetMicros),
    scannerCostEstimateMicros: num(s.scannerCostEstimateMicros),
    assistantCostEstimateMicros: num(s.assistantCostEstimateMicros),
    warningThresholdPct: s.warningThresholdPct,
    breakerFailureThreshold: s.breakerFailureThreshold,
    breakerCooldownSeconds: s.breakerCooldownSeconds,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type AiSettingsView = ReturnType<typeof settingsView>;

export async function getAiOverview(
  userId: string,
  now: Date = new Date(),
  db = defaultPrisma,
) {
  const dayKey = toCairoDateString(now);
  const dayStart = cairoDayStartUtc(dayKey);
  const monthStart = cairoDayStartUtc(`${dayKey.slice(0, 7)}-01`);
  const trendStart = cairoDayStartUtc(addDaysToDateKey(dayKey, -29));
  const month = cairoMonthDate(now);
  return withPlatformAdmin(
    userId,
    async (tx) => {
      const settings = await tx.aiPlatformSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const today = await tx.$queryRaw<
        Array<{
          feature: string;
          provider: string;
          model: string | null;
          status: string;
          error_category: string | null;
          n: bigint;
          est: bigint | null;
          actual: bigint | null;
          input: bigint | null;
          output: bigint | null;
        }>
      >`SELECT feature, provider, model, status, error_category, count(*) AS n,
               sum(estimated_cost_micros) AS est, sum(actual_cost_micros) AS actual,
               sum(input_tokens) AS input, sum(output_tokens) AS output
          FROM ai_usage_events WHERE created_at >= ${dayStart}
         GROUP BY feature, provider, model, status, error_category`;
      const trend = await tx.$queryRaw<
        Array<{ day: string; feature: string; n: bigint; failed: bigint }>
      >`
        SELECT to_char((created_at AT TIME ZONE 'Africa/Cairo')::date, 'YYYY-MM-DD') AS day, feature,
               count(*) FILTER (WHERE status = 'succeeded') AS n,
               count(*) FILTER (WHERE status <> 'succeeded') AS failed
          FROM ai_usage_events WHERE created_at >= ${trendStart}
         GROUP BY 1, 2 ORDER BY 1`;
      const topShops = await tx.$queryRaw<
        Array<{
          store_id: string;
          name: string;
          scans: bigint;
          assistant: bigint;
          est: bigint | null;
        }>
      >`SELECT e.store_id::text AS store_id, s.name,
               count(*) FILTER (WHERE e.feature = 'scanner' AND e.status = 'succeeded') AS scans,
               count(*) FILTER (WHERE e.feature = 'assistant' AND e.status = 'succeeded') AS assistant,
               sum(e.estimated_cost_micros) AS est
          FROM ai_usage_events e JOIN stores s ON s.id = e.store_id
         WHERE e.created_at >= ${monthStart}
         GROUP BY e.store_id, s.name ORDER BY count(*) DESC LIMIT 10`;
      const [assistantToday] = await tx.$queryRaw<Array<{ n: bigint | null }>>`
        SELECT sum(count) AS n FROM ai_usage WHERE day = ${new Date(`${dayKey}T00:00:00Z`)}::date`;
      const budget = await tx.aiBudgetMonth.findUnique({ where: { month } });
      const health = await tx.aiProviderHealth.findMany();

      const sum = (pred: (r: (typeof today)[number]) => boolean) =>
        today.filter(pred).reduce((n, r) => n + num(r.n), 0);
      const byModel = new Map<
        string,
        {
          provider: string;
          model: string | null;
          feature: string;
          requests: number;
          failed: number;
          inputTokens: number;
          outputTokens: number;
        }
      >();
      for (const r of today) {
        const k = `${r.feature}|${r.provider}|${r.model ?? ""}`;
        const row = byModel.get(k) ?? {
          provider: r.provider,
          model: r.model,
          feature: r.feature,
          requests: 0,
          failed: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
        row.requests += num(r.n);
        if (r.status !== "succeeded") row.failed += num(r.n);
        row.inputTokens += num(r.input);
        row.outputTokens += num(r.output);
        byModel.set(k, row);
      }
      const RATE = new Set([
        "global_rpm",
        "global_concurrency",
        "rate_limited",
        "provider_quota",
        "shop_rpm",
        "breaker_open",
        "budget",
      ]);
      const cap = num(settings.monthlyBudgetMicros);
      const spent = num(budget?.spentMicros);
      const reserved = num(budget?.reservedMicros);
      const scanner = defaultVisionProvider();
      const assistant = assistantProviderInfo();
      return {
        generatedAt: now.toISOString(),
        dayKey,
        today: {
          total: sum(() => true),
          scanner: sum(
            (r) => r.feature === "scanner" && r.status === "succeeded",
          ),
          assistant: sum(
            (r) => r.feature === "assistant" && r.status === "succeeded",
          ),
          assistantMessages: num(assistantToday?.n),
          failed: sum((r) => r.status === "failed"),
          rejected: sum((r) => r.status === "rejected"),
          rateLimitEvents: sum((r) => RATE.has(r.error_category ?? "")),
          estimatedCostMicros: today.reduce((n, r) => n + num(r.est), 0),
          actualCostMicros: today.some((r) => r.actual !== null)
            ? today.reduce((n, r) => n + num(r.actual), 0)
            : null,
          byModel: [...byModel.values()],
          errors: today
            .filter((r) => r.error_category)
            .map((r) => ({
              feature: r.feature,
              category: r.error_category!,
              count: num(r.n),
            })),
        },
        trend: trend.map((t) => ({
          day: t.day,
          feature: t.feature,
          succeeded: num(t.n),
          failed: num(t.failed),
        })),
        topShops: topShops.map((s) => ({
          storeId: s.store_id,
          name: s.name,
          scans: num(s.scans),
          assistant: num(s.assistant),
          estimatedCostMicros: num(s.est),
        })),
        budget: {
          monthlyCapMicros: cap,
          spentMicros: spent,
          reservedMicros: reserved,
          remainingMicros: Math.max(0, cap - spent - reserved),
          warning:
            cap > 0 &&
            ((spent + reserved) * 100) / cap >= settings.warningThresholdPct,
        },
        providers: {
          scanner: { provider: scanner.name, model: scanner.model },
          assistant,
        },
        health: health.map((h) => ({
          feature: h.feature,
          available: !h.openUntil || h.openUntil <= now,
          openUntil: h.openUntil?.toISOString() ?? null,
          consecutiveFailures: h.consecutiveFailures,
          lastError: h.lastError,
          lastFailureAt: h.lastFailureAt?.toISOString() ?? null,
          lastSuccessAt: h.lastSuccessAt?.toISOString() ?? null,
        })),
        settings: settingsView(settings),
      };
    },
    db,
  );
}

export async function listShopsForAdmin(
  userId: string,
  q: string,
  now: Date = new Date(),
  db = defaultPrisma,
) {
  const dayKey = toCairoDateString(now);
  const day = new Date(`${dayKey}T00:00:00Z`);
  const month = cairoMonthDate(now);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return withPlatformAdmin(
    userId,
    async (tx) => {
      const settings = await tx.aiPlatformSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          daily_limit: number | null;
          monthly_limit: number | null;
          enabled: boolean | null;
          bonus_credits: number | null;
          used_today: bigint;
          used_month: bigint;
          assistant_today: number | null;
        }>
      >`SELECT s.id::text AS id, s.name, q.daily_limit, q.monthly_limit, q.enabled, q.bonus_credits,
               (SELECT count(*) FROM ai_scan_operations o WHERE o.store_id = s.id AND o.day = ${day}::date
                  AND o.status = 'succeeded' AND NOT o.uses_bonus) AS used_today,
               (SELECT count(*) FROM ai_scan_operations o WHERE o.store_id = s.id AND o.month = ${month}::date
                  AND o.status = 'succeeded' AND NOT o.uses_bonus) AS used_month,
               (SELECT u.count FROM ai_usage u WHERE u.store_id = s.id AND u.day = ${day}::date) AS assistant_today
          FROM stores s LEFT JOIN ai_scanner_shop_quotas q ON q.store_id = s.id
         WHERE ${q} = '' OR s.name ILIKE ${like} OR s.id::text = ${q}
         ORDER BY s.created_at DESC LIMIT 50`;
      return rows.map((r) => {
        const daily = r.daily_limit ?? settings.scannerDailyDefault;
        const monthly = r.monthly_limit ?? settings.scannerMonthlyDefault;
        const usedMonth = num(r.used_month);
        return {
          storeId: r.id,
          name: r.name,
          scannerEnabled: r.enabled ?? true,
          dailyOverride: r.daily_limit,
          monthlyOverride: r.monthly_limit,
          dailyLimit: daily,
          monthlyLimit: monthly,
          usedToday: num(r.used_today),
          usedThisMonth: usedMonth,
          remainingToday: Math.min(
            Math.max(0, daily - num(r.used_today)),
            Math.max(0, monthly - usedMonth),
          ),
          remainingThisMonth: Math.max(0, monthly - usedMonth),
          bonusCredits: r.bonus_credits ?? 0,
          assistantMessagesToday: r.assistant_today ?? 0,
        };
      });
    },
    db,
  );
}

export async function updateShopQuota(
  userId: string,
  storeId: string,
  patch: ShopQuotaPatch,
  db = defaultPrisma,
) {
  return withPlatformAdmin(
    userId,
    async (tx) => {
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      });
      if (!store) throw AppError.notFound("المحل ده مش موجود");
      const before = await tx.aiScannerShopQuota.findUnique({
        where: { storeId },
      });
      const data: Prisma.AiScannerShopQuotaUncheckedUpdateInput = {
        updatedAt: new Date(),
        updatedBy: userId,
      };
      if (patch.dailyLimit !== undefined) data.dailyLimit = patch.dailyLimit;
      if (patch.monthlyLimit !== undefined)
        data.monthlyLimit = patch.monthlyLimit;
      if (patch.enabled !== undefined) data.enabled = patch.enabled;
      if (patch.grantBonusCredits)
        data.bonusCredits = { increment: patch.grantBonusCredits };
      const after = await tx.aiScannerShopQuota.upsert({
        where: { storeId },
        create: {
          storeId,
          dailyLimit: patch.dailyLimit ?? null,
          monthlyLimit: patch.monthlyLimit ?? null,
          enabled: patch.enabled ?? true,
          bonusCredits: patch.grantBonusCredits ?? 0,
          updatedBy: userId,
        },
        update: data,
      });
      const pick = (q: typeof after | null) =>
        q
          ? {
              dailyLimit: q.dailyLimit,
              monthlyLimit: q.monthlyLimit,
              enabled: q.enabled,
              bonusCredits: q.bonusCredits,
            }
          : null;
      await tx.aiAdminAudit.create({
        data: {
          adminUserId: userId,
          targetStoreId: storeId,
          action: patch.grantBonusCredits
            ? "shop_quota_update_and_grant"
            : "shop_quota_update",
          previousValue: (pick(before) ??
            Prisma.JsonNull) as Prisma.InputJsonValue,
          newValue: pick(after) as Prisma.InputJsonValue,
          reason: patch.reason || null,
        },
      });
      return pick(after)!;
    },
    db,
  );
}

export async function updateAiSettings(
  userId: string,
  patch: AiSettingsPatch,
  db = defaultPrisma,
) {
  const { reason, ...changes } = patch;
  const result = await withPlatformAdmin(
    userId,
    async (tx) => {
      const before = await tx.aiPlatformSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      const data: Prisma.AiPlatformSettingsUpdateInput = {
        updatedAt: new Date(),
        updatedBy: userId,
      };
      for (const [k, v] of Object.entries(changes)) {
        if (v === undefined) continue;
        (data as Record<string, unknown>)[k] = k.endsWith("Micros")
          ? BigInt(v as number)
          : v;
      }
      const after = await tx.aiPlatformSettings.update({
        where: { id: 1 },
        data,
      });
      const prev: Record<string, unknown> = {};
      const next: Record<string, unknown> = {};
      const b = settingsView(before) as Record<string, unknown>;
      const a = settingsView(after) as Record<string, unknown>;
      for (const k of Object.keys(changes)) {
        if (b[k] !== a[k]) {
          prev[k] = b[k];
          next[k] = a[k];
        }
      }
      if (Object.keys(next).length > 0) {
        await tx.aiAdminAudit.create({
          data: {
            adminUserId: userId,
            action: "settings_update",
            previousValue: prev as Prisma.InputJsonValue,
            newValue: next as Prisma.InputJsonValue,
            reason: reason || null,
          },
        });
      }
      return settingsView(after);
    },
    db,
  );
  invalidateAiSettingsCache();
  return result;
}

export async function listAiAudit(userId: string, db = defaultPrisma) {
  return withPlatformAdmin(
    userId,
    async (tx) => {
      const rows = await tx.aiAdminAudit.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          admin: { select: { name: true } },
          targetStore: { select: { name: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        admin: r.admin.name,
        shop: r.targetStore?.name ?? null,
        action: r.action,
        previous: r.previousValue,
        next: r.newValue,
        reason: r.reason,
      }));
    },
    db,
  );
}
