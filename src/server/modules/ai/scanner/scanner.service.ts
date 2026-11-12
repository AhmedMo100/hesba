import "server-only";

/**
 * @file scanner.service.ts
 * @description The AI product scanner (ADR-0030): photos → products the model saw → matched
 * to the shop's own products → returned for the shopkeeper to confirm. It never creates a
 * product, an invoice or a stock movement; confirmed lines go into the existing Sales cart and
 * are checked again at checkout.
 *
 * Credits (per shop, Cairo calendar):
 * - one submitted batch of photos = one scan;
 * - limits: daily and monthly (shop override, else the platform default), plus bonus credits
 *   the admin may grant, used once a limit is reached;
 * - a scan is reserved before the provider call (under a row lock, so parallel requests cannot
 *   exceed the limit) and COUNTS only if it ends `succeeded` with a valid answer; a refused,
 *   failed, timed-out or invalid scan is marked `failed` and never counts;
 * - the same `opId` is processed once: a retry after success returns the first result, a retry
 *   after a failure tries again.
 *
 * Platform limits (requests/minute, concurrency, budget, circuit breaker) come from
 * `platform/ai-gate.ts` and are separate from the shop's credits.
 */
import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type AiPlatformSettings,
} from "@prisma/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import {
  GeminiVisionProvider,
  MockVisionProvider,
  ProviderError,
  type ScanImage,
  type VisionProvider,
} from "@/server/infra/ai";
import {
  acquireAiCapacity,
  aiUnavailable,
  cairoMonthDate,
  loadAiSettings,
  SCANNER_DISABLED_MESSAGE,
} from "../platform/ai-gate";
import { recordAiUsage } from "../platform/usage";
import { getCairoMidnightDate, getNextCairoMidnight } from "../cairo-date";
import {
  matchScan,
  type ScanMatch,
  type SeenProduct,
  type ShopProduct,
} from "@/domain/scan-matcher";
import { isServiceProduct } from "@/domain/sale-pricing";
import {
  SCAN_MAX_IMAGES_HARD,
  visionOutputSchema,
  type RecognizedItem,
  type ScanLineView,
  type ScannerQuotaView,
  type ScanResultView,
} from "@/schemas/scanner";

/** How long one scan may take, provider retries included. */
export const SCAN_TIMEOUT_MS = 25_000;
/** A `reserved` scan older than this was abandoned (server died): it no longer counts. */
const STALE_RESERVATION_MS = 2 * 60_000;
/** Longest provider-suggested pause we wait for inside one request before giving up. */
const MAX_INLINE_RETRY_WAIT_S = 3;

export const SCAN_DAILY_LIMIT_MESSAGE =
  "لقد وصلت إلى الحد اليومي المسموح لاستخدام اسكان المنتجات. يمكنك الاستمرار في البحث عن المنتجات وإضافتها يدويًا.";
export const SCAN_MONTHLY_LIMIT_MESSAGE =
  "لقد وصلت إلى الحد الشهري المسموح لاستخدام اسكان المنتجات.";

/** The scanner model for this server: Gemini when a key is configured, else the mock. */
export function defaultVisionProvider(): VisionProvider {
  const key =
    process.env.HESBA_AI_SCANNER_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.HESBA_GEMINI_API_KEY;
  const provider =
    process.env.HESBA_AI_SCANNER_PROVIDER || (key ? "gemini" : "mock");
  if (provider === "gemini" && key && process.env.NODE_ENV !== "test") {
    return new GeminiVisionProvider(key);
  }
  return new MockVisionProvider();
}

interface QuotaRow {
  dailyLimit: number | null;
  monthlyLimit: number | null;
  enabled: boolean;
  bonusCredits: number;
}

interface Usage {
  usedToday: number;
  usedThisMonth: number;
  bonusInFlight: number;
  inFlight: number;
  startedLastMinute: number;
}

async function usageInTx(
  tx: TenantTx,
  storeId: string,
  day: Date,
  month: Date,
  now: Date,
): Promise<Usage> {
  const staleBefore = new Date(now.getTime() - STALE_RESERVATION_MS);
  const minuteAgo = new Date(now.getTime() - 60_000);
  const [row] = await tx.$queryRaw<
    Array<{
      today: bigint;
      month: bigint;
      bonus: bigint;
      inflight: bigint;
      recent: bigint;
    }>
  >`
    SELECT
      COUNT(*) FILTER (WHERE "day" = ${day}::date AND NOT "uses_bonus"
        AND ("status" = 'succeeded' OR ("status" = 'reserved' AND "created_at" > ${staleBefore}))) AS today,
      COUNT(*) FILTER (WHERE NOT "uses_bonus"
        AND ("status" = 'succeeded' OR ("status" = 'reserved' AND "created_at" > ${staleBefore}))) AS month,
      COUNT(*) FILTER (WHERE "uses_bonus" AND "status" = 'reserved' AND "created_at" > ${staleBefore}) AS bonus,
      COUNT(*) FILTER (WHERE "status" = 'reserved' AND "created_at" > ${staleBefore}) AS inflight,
      COUNT(*) FILTER (WHERE "created_at" > ${minuteAgo}) AS recent
    FROM "ai_scan_operations"
    WHERE "store_id" = ${storeId}::uuid AND "month" = ${month}::date`;
  return {
    usedToday: Number(row?.today ?? 0),
    usedThisMonth: Number(row?.month ?? 0),
    bonusInFlight: Number(row?.bonus ?? 0),
    inFlight: Number(row?.inflight ?? 0),
    startedLastMinute: Number(row?.recent ?? 0),
  };
}

function quotaView(
  settings: AiPlatformSettings,
  q: QuotaRow | null,
  u: Usage,
  now: Date,
): ScannerQuotaView {
  const dailyLimit = q?.dailyLimit ?? settings.scannerDailyDefault;
  const monthlyLimit = q?.monthlyLimit ?? settings.scannerMonthlyDefault;
  const disabledReason = !settings.scannerEnabled
    ? "platform"
    : q && !q.enabled
      ? "shop"
      : null;
  const monthLeft = Math.max(0, monthlyLimit - u.usedThisMonth);
  return {
    enabled: disabledReason === null,
    disabledReason,
    dailyLimit,
    monthlyLimit,
    usedToday: u.usedToday,
    usedThisMonth: u.usedThisMonth,
    remainingToday: Math.min(Math.max(0, dailyLimit - u.usedToday), monthLeft),
    remainingThisMonth: monthLeft,
    bonusCredits: Math.max(0, (q?.bonusCredits ?? 0) - u.bonusInFlight),
    maxImages: Math.min(settings.scannerMaxImages, SCAN_MAX_IMAGES_HARD),
    resetsAt: getNextCairoMidnight(now).toISOString(),
  };
}

function describe(s: SeenProduct): string {
  const size = s.sizeValue ? `${s.sizeValue} ${s.sizeUnit ?? ""}`.trim() : null;
  const parts = [
    s.nameAr ?? s.nameEn,
    s.brand && s.brand !== s.nameEn ? s.brand : null,
    s.flavor,
    size,
  ]
    .filter(Boolean)
    .join(" · ");
  return parts || "منتج مش واضح";
}

function toLineView(m: ScanMatch): ScanLineView {
  return {
    key: m.key,
    status: m.status,
    description: describe(m.seen),
    confidence: Math.round(m.seen.confidence * 100) / 100,
    imageIndexes: m.imageIndexes,
    quantity: m.quantity,
    candidates: m.candidates.map((c) => ({
      variantId: c.product.variantId,
      productId: c.product.productId,
      name: c.product.name,
      unit: c.product.unit,
      packQty: c.product.packQty,
      sellPricePiasters: c.product.sellPricePiasters,
      stockBase: c.product.stockBase,
      score: c.score,
    })),
  };
}

/** The shop's sellable stocked products, with prices and stock from the database. */
async function loadShopProducts(
  tx: TenantTx,
  storeId: string,
): Promise<ShopProduct[]> {
  const variants = await tx.storeVariant.findMany({
    where: {
      storeId,
      isActive: true,
      storeProduct: { isActive: true, kind: "standard" },
    },
    select: {
      id: true,
      storeProductId: true,
      flavor: true,
      sizeValue: true,
      sizeUnit: true,
      packQty: true,
      sellPricePiasters: true,
      stockLevels: { select: { quantityBase: true } },
      storeProduct: {
        select: {
          nameAr: true,
          unit: true,
          category: true,
          globalProduct: {
            select: { brand: { select: { nameAr: true, nameEn: true } } },
          },
        },
      },
    },
    take: 5000,
  });
  return variants
    .filter((v) => v.storeProduct && !isServiceProduct(v.storeProduct))
    .map((v) => ({
      variantId: v.id,
      productId: v.storeProductId!,
      name: v.storeProduct!.nameAr ?? "",
      brandAr: v.storeProduct!.globalProduct?.brand?.nameAr ?? null,
      brandEn: v.storeProduct!.globalProduct?.brand?.nameEn ?? null,
      flavor: v.flavor,
      sizeValue: v.sizeValue === null ? null : Number(v.sizeValue),
      sizeUnit: v.sizeUnit,
      packQty: v.packQty,
      unit: v.storeProduct!.unit,
      sellPricePiasters: Number(v.sellPricePiasters),
      stockBase: Math.max(0, Number(v.stockLevels[0]?.quantityBase ?? 0)),
    }));
}

function toSeen(items: RecognizedItem[]): SeenProduct[] {
  return items.map((i) => ({
    imageIndex: i.imageIndex,
    brand: i.brand,
    nameAr: i.nameAr,
    nameEn: i.nameEn,
    flavor: i.flavor,
    sizeValue: i.sizeValue,
    sizeUnit: i.sizeUnit,
    packaging: i.packaging,
    productType: i.productType,
    quantity: i.quantity,
    confidence: i.confidence,
  }));
}

/** The user-facing error for a provider failure. The shop's credit is never taken for it. */
function providerFailure(err: ProviderError): AppError {
  if (err.category === "invalid_output") {
    return AppError.serviceUnavailable(
      "مقدرناش نقرأ نتيجة الاسكان. جرّب تاني — العملية دي مش هتتحسب من رصيدك.",
      { reason: "scan_invalid_output", category: err.category },
    );
  }
  if (err.category === "invalid_request") {
    return AppError.badRequest(
      "الصور دي اترفضت. صوّر تاني بإضاءة أوضح — العملية دي مش هتتحسب من رصيدك.",
      { reason: "scan_invalid_request", category: err.category },
    );
  }
  return aiUnavailable(err.category, err.retryAfterSeconds ?? 60);
}

export class ScannerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly vision: VisionProvider = defaultVisionProvider(),
  ) {}

  async getQuota(
    storeId: string,
    now: Date = new Date(),
  ): Promise<ScannerQuotaView> {
    const settings = await loadAiSettings(this.prisma);
    const day = getCairoMidnightDate(now);
    const month = cairoMonthDate(now);
    return withTenant(
      storeId,
      null,
      async (tx) => {
        const q = await tx.aiScannerShopQuota.findUnique({
          where: { storeId },
        });
        return quotaView(
          settings,
          q,
          await usageInTx(tx, storeId, day, month, now),
          now,
        );
      },
      this.prisma,
    );
  }

  /** Re-matches a stored result against the shop's current products, prices and stock. */
  private async present(
    storeId: string,
    scanId: string,
    items: RecognizedItem[],
    provider: string,
    duplicate: boolean,
    now: Date,
  ): Promise<ScanResultView> {
    const products = await withTenant(
      storeId,
      null,
      (tx) => loadShopProducts(tx, storeId),
      this.prisma,
    );
    return {
      scanId,
      duplicate,
      provider,
      lines: matchScan(toSeen(items), products).map(toLineView),
      quota: await this.getQuota(storeId, now),
    };
  }

  async scan(
    storeId: string,
    userId: string,
    opId: string,
    images: ScanImage[],
    now: Date = new Date(),
  ): Promise<ScanResultView> {
    const settings = await loadAiSettings(this.prisma);
    const maxImages = Math.min(settings.scannerMaxImages, SCAN_MAX_IMAGES_HARD);
    if (images.length === 0)
      throw AppError.badRequest("صوّر منتج واحد على الأقل");
    if (images.length > maxImages) {
      throw AppError.badRequest(`أقصى عدد صور في الاسكان الواحد ${maxImages}`);
    }
    if (!settings.scannerEnabled) {
      throw AppError.serviceUnavailable(SCANNER_DISABLED_MESSAGE, {
        reason: "ai_feature_disabled",
        category: "feature_disabled",
      });
    }

    const day = getCairoMidnightDate(now);
    const month = cairoMonthDate(now);

    // 1. Idempotency + the shop's credit, reserved atomically.
    const reservation = await withTenant(
      storeId,
      userId,
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO "ai_scanner_shop_quotas" ("store_id") VALUES (${storeId}::uuid)
          ON CONFLICT ("store_id") DO NOTHING`;
        const [q] = await tx.$queryRaw<
          Array<{
            daily_limit: number | null;
            monthly_limit: number | null;
            enabled: boolean;
            bonus_credits: number;
          }>
        >`SELECT "daily_limit", "monthly_limit", "enabled", "bonus_credits"
            FROM "ai_scanner_shop_quotas" WHERE "store_id" = ${storeId}::uuid FOR UPDATE`;
        const quota: QuotaRow = {
          dailyLimit: q?.daily_limit ?? null,
          monthlyLimit: q?.monthly_limit ?? null,
          enabled: q?.enabled ?? true,
          bonusCredits: q?.bonus_credits ?? 0,
        };

        const existing = await tx.aiScanOperation.findUnique({
          where: { storeId_opId: { storeId, opId } },
        });
        if (existing?.status === "succeeded") {
          return { replay: existing, op: null };
        }
        const staleBefore = new Date(now.getTime() - STALE_RESERVATION_MS);
        if (
          existing?.status === "reserved" &&
          existing.createdAt > staleBefore
        ) {
          throw AppError.conflict("الاسكان ده لسه بيتعالج، استنى ثواني");
        }
        if (existing && existing.imageCount !== images.length) {
          throw AppError.conflict("رقم العملية ده اتسجل قبل كده لاسكان مختلف");
        }

        if (!quota.enabled) {
          throw AppError.serviceUnavailable(SCANNER_DISABLED_MESSAGE, {
            reason: "ai_scanner_shop_disabled",
            category: "shop_disabled",
          });
        }
        const u = await usageInTx(tx, storeId, day, month, now);
        if (u.inFlight > 0) {
          throw AppError.conflict("في اسكان تاني شغال دلوقتي، استنى لما يخلص");
        }
        if (u.startedLastMinute >= settings.shopRpm) {
          throw AppError.rateLimited(
            "استنى دقيقة قبل الاسكان الجاي",
            { reason: "scan_shop_rpm", category: "shop_rpm" },
            60,
          );
        }
        const view = quotaView(settings, quota, u, now);
        let usesBonus = false;
        if (view.remainingToday <= 0) {
          if (view.bonusCredits > 0) {
            usesBonus = true;
          } else if (u.usedThisMonth >= view.monthlyLimit) {
            throw AppError.rateLimited(SCAN_MONTHLY_LIMIT_MESSAGE, {
              reason: "scan_monthly_limit",
              category: "shop_monthly",
            });
          } else {
            throw AppError.rateLimited(
              SCAN_DAILY_LIMIT_MESSAGE,
              { reason: "scan_daily_limit", category: "shop_daily" },
              (getNextCairoMidnight(now).getTime() - now.getTime()) / 1000,
            );
          }
        }
        const data = {
          status: "reserved",
          day,
          month,
          usesBonus,
          imageCount: images.length,
          provider: this.vision.name,
          model: this.vision.model,
          errorCategory: null,
          result: Prisma.JsonNull,
          createdAt: now,
          finishedAt: null,
        };
        const op = existing
          ? await tx.aiScanOperation.update({
              where: { id: existing.id },
              data,
            })
          : await tx.aiScanOperation.create({
              data: { storeId, opId, ...data },
            });
        return { replay: null, op };
      },
      this.prisma,
    );

    if (reservation.replay) {
      const replay = reservation.replay;
      const items = visionOutputSchema.safeParse(replay.result);
      return this.present(
        storeId,
        replay.id,
        items.success ? items.data.items : [],
        replay.provider ?? this.vision.name,
        true,
        now,
      );
    }
    const op = reservation.op!;
    const requestId = randomUUID();
    const started = Date.now();

    const fail = async (category: string, status: "failed" | "rejected") => {
      await withTenant(
        storeId,
        null,
        (tx) =>
          tx.aiScanOperation.update({
            where: { id: op.id },
            data: {
              status: "failed",
              errorCategory: category,
              finishedAt: new Date(),
            },
          }),
        this.prisma,
      ).catch((err: unknown) =>
        logger.error({ err }, "Could not release a scan reservation"),
      );
      await recordAiUsage(this.prisma, storeId, {
        feature: "scanner",
        provider: this.vision.name,
        model: this.vision.model,
        requestId,
        status,
        errorCategory: category,
        imageCount: images.length,
        latencyMs: Date.now() - started,
      });
    };

    // 2. The platform's capacity (refused before any provider call: no credit is taken).
    let lease;
    try {
      lease = await acquireAiCapacity(
        this.prisma,
        "scanner",
        SCAN_TIMEOUT_MS,
        now,
      );
    } catch (err: unknown) {
      const category =
        err instanceof AppError
          ? String(
              (err.details as { category?: string } | undefined)?.category ??
                "gate",
            )
          : "gate";
      await fail(category, "rejected");
      throw err;
    }

    // 3. The provider, with one bounded retry for a brief failure.
    const signal = AbortSignal.timeout(SCAN_TIMEOUT_MS);
    let items: RecognizedItem[];
    let usage: { promptTokens?: number; completionTokens?: number } | undefined;
    try {
      let attempt = 0;
      for (;;) {
        try {
          const res = await this.vision.recognizeProducts(images, { signal });
          const parsed = visionOutputSchema.safeParse(res.raw);
          if (!parsed.success) throw new ProviderError("invalid_output");
          // A product said to be in a photo that was not sent is dropped.
          items = parsed.data.items.filter((i) => i.imageIndex < images.length);
          usage = res.usage;
          break;
        } catch (err: unknown) {
          const pe =
            err instanceof ProviderError
              ? err
              : new ProviderError("unavailable");
          const wait = pe.retryAfterSeconds ?? 1;
          if (
            attempt >= 1 ||
            !pe.transient ||
            wait > MAX_INLINE_RETRY_WAIT_S ||
            signal.aborted
          ) {
            throw pe;
          }
          attempt += 1;
          await new Promise((r) => setTimeout(r, wait * 1000));
        }
      }
    } catch (err: unknown) {
      const pe =
        err instanceof ProviderError ? err : new ProviderError("unavailable");
      await lease.finish({
        ok: false,
        category: pe.category,
        retryAfterSeconds: pe.retryAfterSeconds,
      });
      await fail(pe.category, "failed");
      logger.warn(
        { storeId, category: pe.category },
        "Scan failed; no credit taken",
      );
      throw providerFailure(pe);
    }

    // 4. A valid answer: the scan counts now (and a bonus credit is used if it was one).
    await withTenant(
      storeId,
      null,
      async (tx) => {
        await tx.aiScanOperation.update({
          where: { id: op.id },
          data: {
            status: "succeeded",
            result: { items } as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        });
        if (op.usesBonus) {
          await tx.$executeRaw`
            UPDATE "ai_scanner_shop_quotas"
               SET "bonus_credits" = GREATEST(0, "bonus_credits" - 1), "updated_at" = CURRENT_TIMESTAMP
             WHERE "store_id" = ${storeId}::uuid`;
        }
      },
      this.prisma,
    );
    await lease.finish({ ok: true });
    await recordAiUsage(this.prisma, storeId, {
      feature: "scanner",
      provider: this.vision.name,
      model: this.vision.model,
      requestId,
      status: "succeeded",
      inputTokens: usage?.promptTokens ?? null,
      outputTokens: usage?.completionTokens ?? null,
      imageCount: images.length,
      estimatedCostMicros: lease.estimatedCostMicros,
      latencyMs: Date.now() - started,
    });
    return this.present(storeId, op.id, items!, this.vision.name, false, now);
  }

  /** Retention: stored scan results (descriptions only) are cleared after `days` days. */
  async clearOldResults(days = 7, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 24 * 3600_000);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_maintenance', 'true', true)`;
      return tx.$executeRaw`
        UPDATE "ai_scan_operations" SET "result" = NULL
         WHERE "created_at" < ${cutoff} AND "result" IS NOT NULL`;
    });
  }
}
