import "server-only";

/**
 * @file ai-gate.ts
 * @description The platform-wide gate in front of every AI provider call (scanner and
 * assistant), shared by all shops and all server instances through Postgres (ADR-0030):
 *
 * 1. the feature switch (admin);
 * 2. the circuit breaker (`ai_provider_health`): after repeated provider failures, or at once
 *    for a settings / billing / quota failure, no call is made until it cools down — then the
 *    next request tries again (automatic recovery);
 * 3. requests per minute per feature (`ai_capacity_minutes`, one atomic upsert);
 * 4. concurrent calls per feature (`ai_inflight` leases that expire on their own);
 * 5. the monthly spending cap (`ai_budget_months`): the estimated cost is reserved before the
 *    call and reconciled after it, under a row lock, so concurrent calls cannot overshoot.
 *
 * A refusal here happens BEFORE any provider call, so callers never charge the shop for it.
 * Nothing here ever raises a limit, switches provider or spends more on its own.
 */
import type { AiPlatformSettings, PrismaClient } from "@prisma/client";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import type { ProviderErrorCategory } from "@/server/infra/ai";
import { toCairoDateString } from "@/domain/time";

export type AiFeature = "scanner" | "assistant";

export type GateRefusal =
  | "feature_disabled"
  | "breaker_open"
  | "global_rpm"
  | "global_concurrency"
  | "budget";

/** The message every user sees when the platform's AI capacity is unavailable (PART 7.6). */
export const AI_GLOBAL_UNAVAILABLE_MESSAGE =
  "تم إيقاف خدمة الذكاء الاصطناعي مؤقتًا بسبب ارتفاع حجم الاستخدام. سيتم تجديد الخدمة في أقرب وقت. يمكنك الاستمرار في البيع بالطريقة العادية.";

/** A platform-side refusal: 503, the generic message, an internal reason for logs and tests. */
export function aiUnavailable(
  reason: GateRefusal | ProviderErrorCategory,
  retryAfterSeconds = 60,
) {
  const err = AppError.serviceUnavailable(AI_GLOBAL_UNAVAILABLE_MESSAGE, {
    reason: "ai_platform_unavailable",
    category: reason,
  });
  err.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return err;
}

/** The feature was switched off by the admin (a different message for the scanner). */
export const SCANNER_DISABLED_MESSAGE = "خدمة اسكان المنتجات غير متاحة حاليًا.";

const SETTINGS_CACHE_MS = 10_000;
let settingsCache: { at: number; value: AiPlatformSettings } | null = null;

/** Drops this instance's cached settings (after an admin change). Other instances: ≤ 10 s. */
export function invalidateAiSettingsCache(): void {
  settingsCache = null;
}

export async function loadAiSettings(
  prisma: PrismaClient,
): Promise<AiPlatformSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_CACHE_MS) {
    return settingsCache.value;
  }
  const row =
    (await prisma.aiPlatformSettings.findUnique({ where: { id: 1 } })) ??
    // The migration inserts the row; this only covers a database where it was removed.
    (await prisma.aiPlatformSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    }));
  settingsCache = { at: Date.now(), value: row };
  return row;
}

/** The Cairo month as the first day of that month (UTC midnight), e.g. 2026-11-01. */
export function cairoMonthDate(now: Date = new Date()): Date {
  return new Date(`${toCairoDateString(now).slice(0, 7)}-01T00:00:00.000Z`);
}

export interface AiLease {
  /** Ends the call: frees the concurrency slot, reconciles the budget, updates the breaker. */
  finish(outcome: {
    ok: boolean;
    category?: ProviderErrorCategory;
    retryAfterSeconds?: number;
    actualCostMicros?: bigint;
  }): Promise<void>;
  readonly estimatedCostMicros: bigint;
}

const LEASE_GRACE_MS = 15_000;

/**
 * Reserves capacity for one provider call or throws the platform-unavailable 503
 * ({@link aiUnavailable}) / the feature-disabled error. `timeoutMs` bounds the lease.
 */
export async function acquireAiCapacity(
  prisma: PrismaClient,
  feature: AiFeature,
  timeoutMs: number,
  now: Date = new Date(),
): Promise<AiLease> {
  const settings = await loadAiSettings(prisma);
  const enabled =
    feature === "scanner" ? settings.scannerEnabled : settings.assistantEnabled;
  if (!enabled) {
    throw feature === "scanner"
      ? AppError.serviceUnavailable(SCANNER_DISABLED_MESSAGE, {
          reason: "ai_feature_disabled",
          category: "feature_disabled",
        })
      : aiUnavailable("feature_disabled", 300);
  }

  const health = await prisma.aiProviderHealth.findUnique({
    where: { feature },
  });
  if (health?.openUntil && health.openUntil > now) {
    throw aiUnavailable(
      "breaker_open",
      (health.openUntil.getTime() - now.getTime()) / 1000,
    );
  }

  const rpm =
    feature === "scanner" ? settings.scannerRpm : settings.assistantRpm;
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const counted =
    rpm > 0
      ? await prisma.$queryRaw<Array<{ count: number }>>`
          INSERT INTO "ai_capacity_minutes" ("feature", "minute", "count")
          VALUES (${feature}, ${minute}, 1)
          ON CONFLICT ("feature", "minute")
          DO UPDATE SET "count" = "ai_capacity_minutes"."count" + 1
          WHERE "ai_capacity_minutes"."count" < ${rpm}
          RETURNING "count"`
      : [];
  if (counted.length === 0) {
    throw aiUnavailable("global_rpm", 60 - now.getUTCSeconds());
  }

  const maxConcurrent =
    feature === "scanner"
      ? settings.scannerMaxConcurrent
      : settings.assistantMaxConcurrent;
  const estimated =
    feature === "scanner"
      ? settings.scannerCostEstimateMicros
      : settings.assistantCostEstimateMicros;
  const month = cairoMonthDate(now);
  const expiresAt = new Date(now.getTime() + timeoutMs + LEASE_GRACE_MS);

  const leaseId = await prisma.$transaction(async (tx) => {
    // One lock per feature: the count and the insert are one step for every instance.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hesba_ai_inflight_${feature}`}))`;
    await tx.aiInflight.deleteMany({
      where: { feature, expiresAt: { lte: now } },
    });
    const active = await tx.aiInflight.count({ where: { feature } });
    if (active >= maxConcurrent)
      return { refused: "global_concurrency" as const };

    if (estimated > BigInt(0)) {
      await tx.$executeRaw`
        INSERT INTO "ai_budget_months" ("month") VALUES (${month}::date)
        ON CONFLICT ("month") DO NOTHING`;
      const reserved = await tx.$queryRaw<Array<{ month: Date }>>`
        UPDATE "ai_budget_months"
           SET "reserved_micros" = "reserved_micros" + ${estimated},
               "updated_at" = CURRENT_TIMESTAMP
         WHERE "month" = ${month}::date
           AND "spent_micros" + "reserved_micros" + ${estimated} <= ${settings.monthlyBudgetMicros}
        RETURNING "month"`;
      if (reserved.length === 0) return { refused: "budget" as const };
    }
    const lease = await tx.aiInflight.create({ data: { feature, expiresAt } });
    return { id: lease.id };
  });
  if (!("id" in leaseId)) {
    const refused: GateRefusal = leaseId.refused;
    logger.warn(
      { feature, refusal: refused },
      "AI request refused by the platform gate",
    );
    throw aiUnavailable(refused, refused === "budget" ? 3600 : 15);
  }

  let finished = false;
  return {
    estimatedCostMicros: estimated,
    async finish(outcome) {
      if (finished) return;
      finished = true;
      try {
        await prisma.aiInflight.deleteMany({ where: { id: leaseId.id } });
        if (estimated > BigInt(0)) {
          // A failed call is not billed by the providers we use: only successes are spent.
          const spent = outcome.ok
            ? (outcome.actualCostMicros ?? estimated)
            : BigInt(0);
          await prisma.$executeRaw`
            UPDATE "ai_budget_months"
               SET "reserved_micros" = GREATEST(0, "reserved_micros" - ${estimated}),
                   "spent_micros" = "spent_micros" + ${spent},
                   "updated_at" = CURRENT_TIMESTAMP
             WHERE "month" = ${month}::date`;
        }
        await recordProviderHealth(prisma, feature, settings, outcome);
      } catch (err: unknown) {
        // Bookkeeping must never turn a good answer into an error; the lease expires anyway.
        logger.error({ err, feature }, "AI lease bookkeeping failed");
      }
    },
  };
}

/** Categories that are settings / account problems: stop calling at once, not after N tries. */
const OPEN_IMMEDIATELY: ReadonlySet<ProviderErrorCategory> = new Set([
  "invalid_key",
  "billing",
  "model_unavailable",
  "provider_quota",
]);

async function recordProviderHealth(
  prisma: PrismaClient,
  feature: AiFeature,
  settings: AiPlatformSettings,
  outcome: {
    ok: boolean;
    category?: ProviderErrorCategory;
    retryAfterSeconds?: number;
  },
): Promise<void> {
  const now = new Date();
  if (outcome.ok) {
    await prisma.aiProviderHealth.upsert({
      where: { feature },
      create: { feature, lastSuccessAt: now },
      update: { consecutiveFailures: 0, openUntil: null, lastSuccessAt: now },
    });
    return;
  }
  const category = outcome.category;
  // Our own bad request or a bad answer says nothing about the provider's health.
  if (
    !category ||
    category === "invalid_request" ||
    category === "invalid_output"
  )
    return;
  const row = await prisma.aiProviderHealth.upsert({
    where: { feature },
    create: {
      feature,
      consecutiveFailures: 1,
      lastError: category,
      lastFailureAt: now,
    },
    update: {
      consecutiveFailures: { increment: 1 },
      lastError: category,
      lastFailureAt: now,
    },
  });
  const open =
    OPEN_IMMEDIATELY.has(category) ||
    row.consecutiveFailures >= settings.breakerFailureThreshold;
  if (open) {
    const seconds = Math.max(
      settings.breakerCooldownSeconds,
      outcome.retryAfterSeconds ?? 0,
    );
    await prisma.aiProviderHealth.update({
      where: { feature },
      data: { openUntil: new Date(now.getTime() + seconds * 1000) },
    });
    logger.warn({ feature, category, seconds }, "AI circuit breaker opened");
  }
}
