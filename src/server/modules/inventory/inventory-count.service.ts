import "server-only";

/**
 * @file inventory-count.service.ts
 * @description Physical stocktaking (الجرد): start a count (whole shop, one category, chosen
 * products), record what is really on the shelves, explain each difference, review, confirm.
 *
 * Rules (the owner decides, the system never guesses):
 * - Difference = counted − expected. The expected quantity is the system's stock AT THE MOMENT
 *   the line is counted, so sales made while counting do not become fake differences. At
 *   confirmation the difference is applied relative to the current stock.
 * - A shortage is NEVER a sale by itself. Its reason is the owner's choice:
 *   - `unrecorded_sale` («اتباع»): stock out with its FEFO cost. What it means depends on the
 *     shop's mode AT CONFIRMATION (stored on the count):
 *     - الكاشير الذكي (pos): a sale nobody rang up — its value at the selling price is a sale
 *       DISCOVERED by the count (no payment method, no customer, no money movement).
 *     - إدارة المحل (simple): the day's sales totals already hold the money of every sale, so it
 *       is stock reconciliation only — no second sale, no loss (`applied_sale_minor` NULL).
 *   - `damaged` («تالف») / `expired` («منتهي الصلاحية») / `lost` («ضايع / مسروق»): a loss,
 *     recorded in `waste_records` as damaged / expired / missing (the
 *     existing loss ledger, so the reports count it once).
 *   - `unknown` («مش عارف»), the default: stock out, reported as an unexplained difference.
 * - A surplus (`surplus`) goes back into stock as a batch at the known cost; it is not a purchase
 *   and moves no money.
 * - Confirmation is atomic and idempotent (`confirm_op_id`); an abandoned count changes nothing.
 *   A closed count is frozen by the database (trigger).
 * - Audit trail: who started (`created_by`), confirmed (`confirmed_by`) or abandoned
 *   (`abandoned_by`) it and when; every stock movement it made carries the count's
 *   `confirm_op_id` as its `op_id`, and every loss notes the count.
 */

import { Prisma } from "@prisma/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { isServiceProduct } from "@/domain/sale-pricing";
import { totalFromUnitCost } from "@/domain/stock/batch-cost";
import type {
  CountLinesQuery,
  CountReason,
  StartInventoryCountInput,
  UpdateInventoryCountInput,
} from "@/schemas/inventory-count";
import { WASTE_REASON_LABELS, type WasteReason } from "@/schemas/inventory";
import { normalizeArabic } from "@/domain/normalize";
import {
  STOCKTAKE_REASON_LABEL,
  stocktakeChartData,
  type StocktakeChartData,
} from "@/domain/stocktake-charts";
import { toCairoDateString } from "@/domain/time";
import {
  lockStockLevelInTx,
  recordWasteInTx,
  takeStockInTx,
  writeLevelInTx,
} from "./inventory.service";

const ZERO = BigInt(0);
const MAX_LINES = 2000;

export const COUNT_BATCH_PREFIX = "CNT-";

export const COUNT_REASON_LABELS: Record<CountReason, string> = {
  unrecorded_sale: "اتباع ومتسجلش",
  damaged: "تالف",
  expired: "منتهي الصلاحية",
  lost: "ضايع / مسروق",
  unknown: "فرق مش معروف سببه",
  surplus: "زيادة عن المتسجل",
};

export interface InventoryCountLineView {
  variantId: string;
  productName: string;
  category: string;
  unit: string;
  packQty: number;
  expectedBase: number;
  countedBase: number | null;
  differenceBase: number | null;
  reason: CountReason | null;
  /** The owner's note on the difference. */
  note: string | null;
  /** The difference's value at cost (null when the cost is unknown or not counted). */
  differenceCostPiasters: number | null;
  /** The difference's value at the selling price. */
  differenceSellPiasters: number | null;
  appliedCostPiasters: number | null;
}

export interface InventoryCountView {
  id: string;
  scope: string;
  category: string | null;
  status: "open" | "confirmed" | "abandoned";
  note: string | null;
  startedAt: string;
  confirmedAt: string | null;
  abandonedAt: string | null;
  /**
   * How a «sold» shortage counts: the mode stored at confirmation, else the shop's mode now.
   * simple → reconciliation of the daily totals (no sale value); pos → a discovered sale.
   */
  salesMode: "simple" | "pos";
  startedBy: string | null;
  closedBy: string | null;
  totals: InventoryCountTotals;
  lines: InventoryCountLineView[];
}

export interface InventoryCountTotals {
  lines: number;
  counted: number;
  matched: number;
  discrepancies: number;
  shortageBase: number;
  surplusBase: number;
  /** Value at cost of all shortages / surpluses (known costs only). */
  shortageCostPiasters: number;
  surplusCostPiasters: number;
  damagedBase: number;
  expiredBase: number;
  lostBase: number;
  /** Products (lines) short / over. */
  shortageLines: number;
  surplusLines: number;
  unrecordedSaleBase: number;
  /** Value at the selling price of the quantities the owner said were sold unrecorded. */
  unrecordedSaleSellPiasters: number;
  unknownBase: number;
  /** Lines whose cost is unknown: their value is left out of the money totals. */
  unknownCostLines: number;
}

type LineRow = Awaited<ReturnType<typeof linesOf>>[number];

async function linesOf(tx: TenantTx, storeId: string, sessionId: string) {
  return tx.inventoryCountLine.findMany({
    where: { storeId, sessionId },
    // All lines of a count are inserted together (same created_at): the id breaks the tie so
    // the order never changes between answers (the screen walks the lines one by one).
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      storeVariant: {
        select: {
          id: true,
          packQty: true,
          flavor: true,
          barcode: true,
          storeProduct: {
            select: {
              nameAr: true,
              unit: true,
              category: true,
              globalProduct: { select: { nameAr: true } },
            },
          },
        },
      },
    },
  });
}

function valueOf(
  unitPiasters: bigint | null,
  qtyBase: bigint,
  unit: string,
): number | null {
  if (unitPiasters === null) return null;
  const total = totalFromUnitCost(unitPiasters, qtyBase, unit);
  return total === null ? null : Number(total);
}

function lineView(l: LineRow): InventoryCountLineView {
  const p = l.storeVariant.storeProduct;
  const unit = p?.unit ?? "piece";
  const diff = l.countedBase === null ? null : l.countedBase - l.expectedBase;
  const abs = diff === null ? null : diff < ZERO ? -diff : diff;
  const name =
    (p?.nameAr || p?.globalProduct?.nameAr || "صنف") +
    (l.storeVariant.flavor ? ` — ${l.storeVariant.flavor}` : "");
  return {
    variantId: l.storeVariantId,
    productName: name,
    category: p?.category ?? "",
    unit,
    packQty: l.storeVariant.packQty,
    expectedBase: Number(l.expectedBase),
    countedBase: l.countedBase === null ? null : Number(l.countedBase),
    differenceBase: diff === null ? null : Number(diff),
    reason: (l.reason as CountReason | null) ?? null,
    note: l.note ?? null,
    differenceCostPiasters:
      abs === null || abs === ZERO
        ? abs === ZERO
          ? 0
          : null
        : valueOf(l.unitCostMinor, abs, unit),
    differenceSellPiasters:
      abs === null || abs === ZERO
        ? abs === ZERO
          ? 0
          : null
        : valueOf(l.unitPriceMinor, abs, unit),
    appliedCostPiasters:
      l.appliedCostMinor === null ? null : Number(l.appliedCostMinor),
  };
}

function totalsOf(
  lines: InventoryCountLineView[],
  salesMode: "simple" | "pos",
): InventoryCountTotals {
  const t: InventoryCountTotals = {
    lines: lines.length,
    counted: 0,
    matched: 0,
    discrepancies: 0,
    shortageBase: 0,
    surplusBase: 0,
    shortageCostPiasters: 0,
    surplusCostPiasters: 0,
    damagedBase: 0,
    expiredBase: 0,
    lostBase: 0,
    shortageLines: 0,
    surplusLines: 0,
    unrecordedSaleBase: 0,
    unrecordedSaleSellPiasters: 0,
    unknownBase: 0,
    unknownCostLines: 0,
  };
  for (const l of lines) {
    if (l.countedBase === null || l.differenceBase === null) continue;
    t.counted += 1;
    if (l.differenceBase === 0) {
      t.matched += 1;
      continue;
    }
    t.discrepancies += 1;
    if (l.differenceCostPiasters === null) t.unknownCostLines += 1;
    const cost = l.differenceCostPiasters ?? 0;
    if (l.differenceBase > 0) {
      t.surplusLines += 1;
      t.surplusBase += l.differenceBase;
      t.surplusCostPiasters += cost;
      continue;
    }
    const q = -l.differenceBase;
    t.shortageLines += 1;
    t.shortageBase += q;
    t.shortageCostPiasters += cost;
    const reason = l.reason ?? "unknown";
    if (reason === "damaged") t.damagedBase += q;
    else if (reason === "expired") t.expiredBase += q;
    else if (reason === "lost") t.lostBase += q;
    else if (reason === "unrecorded_sale") {
      t.unrecordedSaleBase += q;
      // إدارة المحل: the money is already in the daily totals — no sale value is added.
      if (salesMode === "pos")
        t.unrecordedSaleSellPiasters += l.differenceSellPiasters ?? 0;
    } else t.unknownBase += q;
  }
  return t;
}

async function viewInTx(
  tx: TenantTx,
  storeId: string,
  sessionId: string,
): Promise<InventoryCountView> {
  const s = await tx.inventoryCount.findFirst({
    where: { storeId, id: sessionId },
    include: {
      user: { select: { name: true } },
      confirmer: { select: { name: true } },
      abandoner: { select: { name: true } },
      store: { select: { operatingMode: true } },
    },
  });
  if (!s) throw AppError.notFound("الجرد ده مش موجود");
  const salesMode =
    (s.operatingMode ?? s.store.operatingMode) === "pos" ? "pos" : "simple";
  const lines = (await linesOf(tx, storeId, s.id)).map(lineView);
  return {
    id: s.id,
    scope: s.scope,
    category: s.category,
    status: s.status as InventoryCountView["status"],
    note: s.note,
    startedAt: s.startedAt.toISOString(),
    confirmedAt: s.confirmedAt?.toISOString() ?? null,
    abandonedAt: s.abandonedAt?.toISOString() ?? null,
    salesMode,
    startedBy: s.user?.name ?? null,
    closedBy: s.confirmer?.name ?? s.abandoner?.name ?? null,
    totals: totalsOf(lines, salesMode),
    lines,
  };
}

/** The unit cost a difference is valued at: the newest batch with a cost, else the buy price. */
async function unitCostInTx(
  tx: TenantTx,
  storeId: string,
  variant: { id: string; buyPricePiasters: bigint | null },
  productBuy: bigint | null,
): Promise<bigint | null> {
  const batch = await tx.storeStockBatch.findFirst({
    where: {
      storeId,
      storeVariantId: variant.id,
      costPriceMinor: { gt: ZERO },
    },
    orderBy: { receivedAt: "desc" },
    select: { costPriceMinor: true },
  });
  if (batch?.costPriceMinor) return batch.costPriceMinor;
  if (variant.buyPricePiasters && variant.buyPricePiasters > ZERO)
    return variant.buyPricePiasters;
  if (productBuy && productBuy > ZERO) return productBuy;
  return null;
}

async function currentLevelInTx(
  tx: TenantTx,
  storeId: string,
  variantId: string,
): Promise<bigint> {
  const level = await tx.stockLevel.findFirst({
    where: { storeId, storeVariantId: variantId },
    select: { quantityBase: true },
  });
  return level?.quantityBase ?? ZERO;
}

// ─────────────────────────────────────────────────────────────────────────────────────────

/** The stocktaking page: the count in progress, the history, and the last confirmed count. */
export async function getInventoryCountsOverview(
  storeId: string,
  userId: string | null,
) {
  return withTenant(storeId, userId, async (tx) => {
    const sessions = await tx.inventoryCount.findMany({
      where: { storeId },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: {
        lines: {
          select: {
            expectedBase: true,
            countedBase: true,
            reason: true,
            appliedCostMinor: true,
          },
        },
      },
    });
    const history = sessions.map((s) => {
      let counted = 0;
      let discrepancies = 0;
      let damagedBase = 0;
      let shortageCost = 0;
      let surplusCost = 0;
      for (const l of s.lines) {
        if (l.countedBase === null) continue;
        counted += 1;
        const d = l.countedBase - l.expectedBase;
        if (d !== ZERO) discrepancies += 1;
        if (d < ZERO && l.reason === "damaged") damagedBase += Number(-d);
        if (l.appliedCostMinor !== null) {
          if (d < ZERO) shortageCost += Number(l.appliedCostMinor);
          else if (d > ZERO) surplusCost += Number(l.appliedCostMinor);
        }
      }
      return {
        id: s.id,
        scope: s.scope,
        category: s.category,
        status: s.status,
        startedAt: s.startedAt.toISOString(),
        confirmedAt: s.confirmedAt?.toISOString() ?? null,
        lines: s.lines.length,
        counted,
        discrepancies,
        damagedBase,
        shortageCostPiasters: shortageCost,
        surplusCostPiasters: surplusCost,
      };
    });
    const lastConfirmed = history.find((h) => h.status === "confirmed") ?? null;
    const open = history.find((h) => h.status === "open") ?? null;
    // «اختار قسم» (ADR-0039): each section with how many products it holds — so the page never
    // loads the shop's whole product list to start a count. The same products `start` counts.
    const groups = await tx.$queryRaw<
      Array<{ category: string; unit: string; n: bigint }>
    >`
      SELECT sp.category, sp.unit, COUNT(*)::bigint AS n
        FROM store_variants sv
        JOIN store_products sp ON sp.id = sv.store_product_id
       WHERE sv.store_id = ${storeId}::uuid AND sv.is_active AND sp.is_active
         AND sp.kind <> 'sandwich'
       GROUP BY sp.category, sp.unit`;
    const byCategory = new Map<string, number>();
    for (const g of groups) {
      if (isServiceProduct({ unit: g.unit, category: g.category })) continue;
      byCategory.set(
        g.category,
        (byCategory.get(g.category) ?? 0) + Number(g.n),
      );
    }
    const sections = [...byCategory]
      .map(([category, products]) => ({ category, products }))
      .sort(
        (a, b) =>
          b.products - a.products || a.category.localeCompare(b.category, "ar"),
      );
    return {
      sections,
      lastConfirmedAt: lastConfirmed?.confirmedAt ?? null,
      daysSinceLastCount: lastConfirmed?.confirmedAt
        ? Math.floor(
            (Date.now() - new Date(lastConfirmed.confirmedAt).getTime()) /
              86_400_000,
          )
        : null,
      open,
      history,
    };
  });
}

export async function getInventoryCount(
  storeId: string,
  userId: string | null,
  id: string,
): Promise<InventoryCountView> {
  return withTenant(storeId, userId, (tx) => viewInTx(tx, storeId, id));
}

const LINE_INCLUDE = {
  storeVariant: {
    select: {
      id: true,
      packQty: true,
      flavor: true,
      barcode: true,
      storeProduct: {
        select: {
          nameAr: true,
          unit: true,
          category: true,
          globalProduct: { select: { nameAr: true } },
        },
      },
    },
  },
} as const;

/** How far back «تالف مسجل قبل كده» looks. */
const WASTE_LOOKBACK_DAYS = 90;

/** A count line with what the counting screen shows next to it (ADR-0039). */
export interface CountLineDetail extends InventoryCountLineView {
  barcode: string | null;
  /**
   * Damage recorded on this product lately: help only. It already left Hesba's stock when it
   * was recorded, so it is never added to the count's difference again.
   */
  wasteBefore: {
    quantityBase: number;
    records: Array<{
      quantityBase: number;
      reason: string;
      reasonLabel: string;
      source: string | null;
      at: string;
    }>;
  } | null;
  /** Of the stock Hesba holds for it, what sits in batches past their expiry date. */
  expiredBase: number;
}

export interface CountLinesPage {
  status: "open" | "confirmed" | "abandoned";
  lines: CountLineDetail[];
  /** The cursor of the next page, or null at the end. */
  next: number | null;
  /** The count's progress: lines counted / all its lines. */
  counted: number;
  total: number;
  /** A scanned barcode that is the shop's but not in this count (another section). */
  elsewhere: { name: string; category: string } | null;
}

type DetailRow = Prisma.InventoryCountLineGetPayload<{
  include: typeof LINE_INCLUDE;
}>;

async function pageOf(
  tx: TenantTx,
  storeId: string,
  sessionId: string,
  status: CountLinesPage["status"],
  rows: DetailRow[],
  next: number | null,
  elsewhere: CountLinesPage["elsewhere"] = null,
): Promise<CountLinesPage> {
  const ids = rows.map((r) => r.storeVariantId);
  const since = new Date(Date.now() - WASTE_LOOKBACK_DAYS * 86_400_000);
  const today = new Date(`${toCairoDateString(new Date())}T00:00:00Z`);
  const [total, counted, waste, expired] = await Promise.all([
    tx.inventoryCountLine.count({ where: { storeId, sessionId } }),
    tx.inventoryCountLine.count({
      where: { storeId, sessionId, countedBase: { not: null } },
    }),
    ids.length === 0
      ? Promise.resolve([])
      : tx.wasteRecord.findMany({
          where: {
            storeId,
            storeVariantId: { in: ids },
            createdAt: { gte: since },
          },
          orderBy: { createdAt: "desc" },
          take: 300,
          select: {
            storeVariantId: true,
            quantityBase: true,
            reason: true,
            source: true,
            createdAt: true,
          },
        }),
    ids.length === 0
      ? Promise.resolve([])
      : tx.storeStockBatch.groupBy({
          by: ["storeVariantId"],
          where: {
            storeId,
            storeVariantId: { in: ids },
            remainingQuantityBase: { gt: ZERO },
            expiryDate: { lt: today },
          },
          _sum: { remainingQuantityBase: true },
        }),
  ]);
  const expiredOf = new Map(
    expired.map((e) => [
      e.storeVariantId,
      Number(e._sum.remainingQuantityBase ?? ZERO),
    ]),
  );
  const lines = rows.map((r): CountLineDetail => {
    const mine = waste.filter((w) => w.storeVariantId === r.storeVariantId);
    return {
      ...lineView(r),
      barcode: r.storeVariant.barcode ?? null,
      wasteBefore:
        mine.length === 0
          ? null
          : {
              quantityBase: mine.reduce(
                (n, w) => n + Number(w.quantityBase),
                0,
              ),
              records: mine.slice(0, 3).map((w) => ({
                quantityBase: Number(w.quantityBase),
                reason: w.reason,
                reasonLabel:
                  WASTE_REASON_LABELS[w.reason as WasteReason] ?? w.reason,
                source: w.source,
                at: w.createdAt.toISOString(),
              })),
            },
      expiredBase: r.storeVariantId
        ? (expiredOf.get(r.storeVariantId) ?? 0)
        : 0,
    };
  });
  return { status, lines, next, counted, total, elsewhere };
}

/**
 * One page of a count's lines (ADR-0039): by barcode, by name (Arabic letters normalised), by
 * product, or by state. Read only; the same tenant transaction as everything else.
 */
export async function getInventoryCountLines(
  storeId: string,
  userId: string | null,
  id: string,
  query: CountLinesQuery,
): Promise<CountLinesPage> {
  return withTenant(storeId, userId, async (tx) => {
    const s = await tx.inventoryCount.findFirst({
      where: { storeId, id },
      select: { id: true, status: true },
    });
    if (!s) throw AppError.notFound("الجرد ده مش موجود");
    const status = s.status as CountLinesPage["status"];
    const where: Prisma.InventoryCountLineWhereInput = {
      storeId,
      sessionId: id,
    };
    if (query.variantId) where.storeVariantId = query.variantId;
    if (query.barcode) where.storeVariant = { barcode: query.barcode };
    if (query.status === "pending") where.countedBase = null;
    if (query.status === "counted" || query.status === "diff")
      where.countedBase = { not: null };
    const orderBy = [{ createdAt: "asc" as const }, { id: "asc" as const }];

    // A name search or «فيه فرق» needs every candidate line (a count holds ≤ 2000), then one
    // page of them; everything else is paged by the database.
    if (query.q || query.status === "diff") {
      const all = await tx.inventoryCountLine.findMany({
        where,
        orderBy,
        include: LINE_INCLUDE,
      });
      const q = query.q ? normalizeArabic(query.q) : null;
      const hits = all.filter((r) => {
        if (
          query.status === "diff" &&
          (r.countedBase === null || r.countedBase === r.expectedBase)
        )
          return false;
        if (!q) return true;
        const v = r.storeVariant;
        const text = normalizeArabic(
          `${v.storeProduct?.nameAr ?? ""} ${v.storeProduct?.globalProduct?.nameAr ?? ""} ${v.flavor ?? ""}`,
        );
        return text.includes(q) || (v.barcode ?? "") === query.q;
      });
      const page = hits.slice(query.cursor, query.cursor + query.limit);
      const next =
        query.cursor + query.limit < hits.length
          ? query.cursor + query.limit
          : null;
      return pageOf(tx, storeId, id, status, page, next);
    }

    const rows = await tx.inventoryCountLine.findMany({
      where,
      orderBy,
      include: LINE_INCLUDE,
      skip: query.cursor,
      take: query.limit + 1,
    });
    const next = rows.length > query.limit ? query.cursor + query.limit : null;
    let elsewhere: CountLinesPage["elsewhere"] = null;
    if (query.barcode && rows.length === 0) {
      // The shop's product, but not in this count: say where it is instead of «مش موجود».
      const v = await tx.storeVariant.findFirst({
        where: { storeId, barcode: query.barcode, isActive: true },
        select: {
          storeProduct: {
            select: {
              nameAr: true,
              category: true,
              globalProduct: { select: { nameAr: true } },
            },
          },
        },
      });
      if (v?.storeProduct) {
        elsewhere = {
          name:
            v.storeProduct.nameAr ||
            v.storeProduct.globalProduct?.nameAr ||
            "صنف",
          category: v.storeProduct.category ?? "",
        };
      }
    }
    return pageOf(
      tx,
      storeId,
      id,
      status,
      rows.slice(0, query.limit),
      next,
      elsewhere,
    );
  });
}

/** «اعمل جرد جديد». One count may be open at a time; a retry with the same opId returns it. */
export async function startInventoryCount(
  storeId: string,
  userId: string | null,
  input: StartInventoryCountInput,
): Promise<InventoryCountView> {
  return withTenant(storeId, userId, async (tx) => {
    const same = await tx.inventoryCount.findFirst({
      where: { storeId, opId: input.opId },
      select: { id: true },
    });
    if (same) return viewInTx(tx, storeId, same.id);
    const open = await tx.inventoryCount.findFirst({
      where: { storeId, status: "open" },
      select: { id: true },
    });
    if (open) {
      throw new AppError(
        "CONFLICT",
        "فيه جرد مفتوح لسه. كمّله أو الغيه الأول.",
        409,
        { openCountId: open.id },
      );
    }

    const variants = await tx.storeVariant.findMany({
      where: {
        storeId,
        isActive: true,
        ...(input.scope === "selected"
          ? { id: { in: input.variantIds ?? [] } }
          : {}),
        storeProduct: {
          isActive: true,
          kind: { not: "sandwich" },
          ...(input.scope === "category" ? { category: input.category! } : {}),
        },
      },
      select: {
        id: true,
        buyPricePiasters: true,
        sellPricePiasters: true,
        storeProduct: {
          select: { unit: true, category: true, buyPricePiasters: true },
        },
      },
      take: MAX_LINES + 1,
    });
    const physical = variants.filter(
      (v) => v.storeProduct && !isServiceProduct(v.storeProduct),
    );
    if (physical.length === 0) {
      throw AppError.badRequest("مفيش أصناف تتجرد هنا");
    }
    if (physical.length > MAX_LINES) {
      throw AppError.badRequest(
        `الجرد ده فيه أكتر من ${MAX_LINES} صنف: اجرد قسم قسم`,
      );
    }

    let session;
    try {
      session = await tx.inventoryCount.create({
        data: {
          storeId,
          opId: input.opId,
          scope: input.scope,
          category: input.scope === "category" ? input.category! : null,
          note: input.note?.trim() || null,
          createdBy: userId,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw AppError.conflict("فيه جرد مفتوح لسه. كمّله أو الغيه الأول.");
      }
      throw err;
    }
    const levels = await tx.stockLevel.findMany({
      where: { storeId, storeVariantId: { in: physical.map((v) => v.id) } },
      select: { storeVariantId: true, quantityBase: true },
    });
    const levelOf = new Map(
      levels.map((l) => [l.storeVariantId, l.quantityBase]),
    );
    const rows = [];
    for (const v of physical) {
      rows.push({
        storeId,
        sessionId: session.id,
        storeVariantId: v.id,
        expectedBase: levelOf.get(v.id) ?? ZERO,
        unitCostMinor: await unitCostInTx(
          tx,
          storeId,
          v,
          v.storeProduct?.buyPricePiasters ?? null,
        ),
        unitPriceMinor: v.sellPricePiasters > ZERO ? v.sellPricePiasters : ZERO,
      });
    }
    await tx.inventoryCountLine.createMany({ data: rows });
    return viewInTx(tx, storeId, session.id);
  });
}

async function openSessionInTx(tx: TenantTx, storeId: string, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id::text AS id, status FROM inventory_counts
     WHERE id = ${id}::uuid AND store_id = ${storeId}::uuid FOR UPDATE`;
  const s = rows[0];
  if (!s) throw AppError.notFound("الجرد ده مش موجود");
  return s;
}

/** Saves counted quantities and reasons. The expected quantity is refreshed at that moment. */
export async function updateInventoryCount(
  storeId: string,
  userId: string | null,
  id: string,
  input: UpdateInventoryCountInput,
): Promise<InventoryCountView> {
  return withTenant(storeId, userId, async (tx) => {
    await applyCountLinesInTx(tx, storeId, id, input);
    return viewInTx(tx, storeId, id);
  });
}

/**
 * The same save, answered briefly (ADR-0039): only the lines that changed, with the count's
 * progress — never the whole count again. The counting screen saves every product this way.
 */
export async function updateInventoryCountBrief(
  storeId: string,
  userId: string | null,
  id: string,
  input: UpdateInventoryCountInput,
): Promise<CountLinesPage> {
  return withTenant(storeId, userId, async (tx) => {
    const ids = await applyCountLinesInTx(tx, storeId, id, input);
    const rows = await tx.inventoryCountLine.findMany({
      where: { storeId, sessionId: id, storeVariantId: { in: ids } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: LINE_INCLUDE,
    });
    return pageOf(tx, storeId, id, "open", rows, null);
  });
}

async function applyCountLinesInTx(
  tx: TenantTx,
  storeId: string,
  id: string,
  input: UpdateInventoryCountInput,
): Promise<string[]> {
  const s = await openSessionInTx(tx, storeId, id);
  if (s.status !== "open") {
    throw AppError.conflict("الجرد ده اتقفل، مينفعش يتعدل");
  }
  const now = new Date();
  for (const l of input.lines) {
    const line = await tx.inventoryCountLine.findFirst({
      where: { storeId, sessionId: id, storeVariantId: l.variantId },
      select: { id: true },
    });
    if (!line) throw AppError.notFound("الصنف ده مش في الجرد ده");
    if (l.countedBase === null) {
      await tx.inventoryCountLine.update({
        where: { id: line.id },
        data: { countedBase: null, reason: null, note: null, updatedAt: now },
      });
      continue;
    }
    const expected = await currentLevelInTx(tx, storeId, l.variantId);
    const counted = BigInt(l.countedBase);
    const diff = counted - expected;
    let reason: CountReason | null = l.reason ?? null;
    if (diff === ZERO) reason = null;
    else if (diff > ZERO) reason = "surplus";
    else if (!reason || reason === "surplus") reason = "unknown";
    await tx.inventoryCountLine.update({
      where: { id: line.id },
      data: {
        expectedBase: expected,
        countedBase: counted,
        reason,
        // No difference, no note; otherwise the note sent (undefined keeps the saved one).
        ...(diff === ZERO
          ? { note: null }
          : l.note !== undefined
            ? { note: l.note?.trim() || null }
            : {}),
        updatedAt: now,
      },
    });
  }
  return input.lines.map((l) => l.variantId);
}

export async function abandonInventoryCount(
  storeId: string,
  userId: string | null,
  id: string,
): Promise<InventoryCountView> {
  return withTenant(storeId, userId, async (tx) => {
    const s = await openSessionInTx(tx, storeId, id);
    if (s.status === "abandoned") return viewInTx(tx, storeId, id);
    if (s.status !== "open") {
      throw AppError.conflict("الجرد ده اتأكد خلاص، مينفعش يتلغي");
    }
    await tx.inventoryCount.update({
      where: { id },
      data: {
        status: "abandoned",
        abandonedAt: new Date(),
        abandonedBy: userId,
      },
    });
    return viewInTx(tx, storeId, id);
  });
}

/** Puts a counted surplus back into stock: a batch at the known cost, no money moved. */
async function addSurplusInTx(
  tx: TenantTx,
  storeId: string,
  variantId: string,
  qty: bigint,
  unitCost: bigint | null,
  unit: string,
  now: Date,
  opId: string,
): Promise<bigint | null> {
  const variant = await tx.storeVariant.findFirst({
    where: { storeId, id: variantId },
    select: { storeProductId: true },
  });
  const current = await lockStockLevelInTx(tx, storeId, variantId);
  const total =
    unitCost === null ? null : totalFromUnitCost(unitCost, qty, unit);
  const batch = await tx.storeStockBatch.create({
    data: {
      storeId,
      storeVariantId: variantId,
      storeProductId: variant?.storeProductId ?? null,
      batchCode: `${COUNT_BATCH_PREFIX}${now.getTime().toString(36).toUpperCase()}`,
      receivedQuantityBase: qty,
      remainingQuantityBase: qty,
      costPriceMinor: unitCost,
      costTotalMinor: total,
      receivedAt: now,
      paid: true,
    },
  });
  const after = current + qty;
  await writeLevelInTx(tx, storeId, variantId, after, now);
  await tx.stockMovement.create({
    data: {
      storeId,
      storeVariantId: variantId,
      storeProductId: variant?.storeProductId ?? null,
      batchId: batch.id,
      type: "count_adjustment",
      quantityBase: qty,
      costPriceMinor: unitCost,
      balanceAfterBase: after,
      negative: after < ZERO,
      opId,
      createdAt: now,
    },
  });
  return total;
}

/**
 * Confirms the count: every counted difference is applied in ONE transaction, by its reason.
 * Idempotent: the same `opId` returns the confirmed count; another opId on a confirmed count
 * is a 409. A shortage larger than the stock left now is a 409 (nothing applied).
 */
export async function confirmInventoryCount(
  storeId: string,
  userId: string | null,
  id: string,
  opId: string,
): Promise<InventoryCountView> {
  return withTenant(storeId, userId, async (tx) => {
    const s = await openSessionInTx(tx, storeId, id);
    if (s.status === "confirmed") {
      const done = await tx.inventoryCount.findFirst({
        where: { storeId, id },
        select: { confirmOpId: true },
      });
      if (done?.confirmOpId === opId) return viewInTx(tx, storeId, id);
      throw AppError.conflict("الجرد ده اتأكد قبل كده");
    }
    if (s.status !== "open") {
      throw AppError.conflict("الجرد ده اتلغى، مينفعش يتأكد");
    }
    const lines = await linesOf(tx, storeId, id);
    const counted = lines.filter((l) => l.countedBase !== null);
    if (counted.length === 0) {
      throw AppError.badRequest("اجرد صنف واحد على الأقل قبل التأكيد");
    }
    const now = new Date();
    // The mode decides what «اتباع» means for the reports; stored so a later switch of the
    // shop's mode never rewrites this count's history.
    const store = await tx.store.findFirst({
      where: { id: storeId },
      select: { operatingMode: true },
    });
    const mode = store?.operatingMode === "pos" ? "pos" : "simple";
    const countRef = `جرد ${now.toISOString().slice(0, 10)} (${id.slice(0, 8)})`;
    for (const l of counted) {
      const diff = l.countedBase! - l.expectedBase;
      if (diff === ZERO) continue;
      const unit = l.storeVariant.storeProduct?.unit ?? "piece";
      const variantId = l.storeVariantId;
      let appliedCost: bigint | null = null;
      if (diff > ZERO) {
        appliedCost = await addSurplusInTx(
          tx,
          storeId,
          variantId,
          diff,
          l.unitCostMinor,
          unit,
          now,
          opId,
        );
      } else {
        const qty = -diff;
        const available = await lockStockLevelInTx(tx, storeId, variantId);
        if (qty > available) {
          throw new AppError(
            "CONFLICT",
            `«${lineView(l).productName}»: الفرق (${Number(qty)}) أكبر من الموجود دلوقتي (${Number(available < ZERO ? ZERO : available)}). اتباع منه بعد ما جردته؟ عدّل الكمية المعدودة.`,
            409,
            { variantId },
          );
        }
        const reason = (l.reason as CountReason | null) ?? "unknown";
        if (reason === "damaged" || reason === "expired" || reason === "lost") {
          const w = await recordWasteInTx(tx, storeId, {
            storeVariantId: variantId,
            quantityBase: qty,
            reason:
              reason === "damaged"
                ? "damaged"
                : reason === "expired"
                  ? "expired"
                  : "missing",
            note: l.note ? `${countRef} · ${l.note}`.slice(0, 500) : countRef,
            source: "stocktake",
            createdBy: userId,
          });
          const rec = await tx.wasteRecord.findFirst({
            where: { storeId, id: w.wasteId },
            select: { costMinor: true },
          });
          appliedCost = rec?.costMinor ?? null;
        } else {
          const product = await tx.storeVariant.findFirst({
            where: { storeId, id: variantId },
            select: { storeProductId: true },
          });
          const taken = await takeStockInTx(tx, storeId, {
            storeVariantId: variantId,
            storeProductId: product?.storeProductId ?? null,
            quantityBase: qty,
            type: "count_adjustment",
            opId,
            now,
          });
          appliedCost = taken.costPiasters;
        }
      }
      // Only a cashier shop discovers a sale; in إدارة المحل its money is in the daily totals.
      const saleValue =
        diff < ZERO && l.reason === "unrecorded_sale" && mode === "pos"
          ? valueOf(l.unitPriceMinor, -diff, unit)
          : null;
      await tx.inventoryCountLine.update({
        where: { id: l.id },
        data: {
          appliedDeltaBase: diff,
          appliedCostMinor: appliedCost,
          appliedSaleMinor: saleValue === null ? null : BigInt(saleValue),
          updatedAt: now,
        },
      });
    }
    await tx.inventoryCount.update({
      where: { id },
      data: {
        status: "confirmed",
        confirmOpId: opId,
        confirmedAt: now,
        confirmedBy: userId,
        operatingMode: mode,
      },
    });
    return viewInTx(tx, storeId, id);
  });
}

/**
 * What confirmed counts did in a period — for the reports: the sales the owner said were made
 * unrecorded (value at the selling price, cost at FEFO), and the unexplained shortages (cost).
 * Damaged / lost quantities are NOT here: they are in `waste_records` (counted there once).
 */
export async function countEffectsInRange(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<CountEffects> {
  const rows = await tx.$queryRaw<CountEffectsRow[]>`
    WITH l AS (${confirmedCountLines(storeId, from, to)})
    SELECT ${COUNT_EFFECTS_SELECT} FROM l`;
  return countEffectsFromRow(rows[0]);
}

/**
 * The applied lines of the counts confirmed in [from, to), each with `count_mode` (the shop's
 * mode at confirmation). The source `l` of {@link COUNT_EFFECTS_SELECT}, shared with the
 * report's single profit query.
 */
export function confirmedCountLines(
  storeId: string,
  from: Date | null,
  to: Date,
): Prisma.Sql {
  return Prisma.sql`
    SELECT l.*, s.operating_mode AS count_mode
      FROM inventory_count_lines l
      JOIN inventory_counts s ON s.id = l.session_id
     WHERE l.store_id = ${storeId}::uuid AND s.status = 'confirmed'
       AND s.confirmed_at < ${to}
       AND (${from}::timestamptz IS NULL OR s.confirmed_at >= ${from}::timestamptz)
       AND l.applied_delta_base <> 0`;
}

export interface CountEffects {
  discoveredSalesPiasters: number;
  discoveredSalesCostPiasters: number;
  discoveredSalesUnknownCost: boolean;
  unknownShortageCostPiasters: number;
  /**
   * إدارة المحل: cost of the goods the owner said were sold — their money is already in the
   * daily totals, so this is neither a sale nor a loss (shown for information only).
   */
  reconciledSoldCostPiasters: number;
  surplusCostPiasters: number;
  counts: number;
}

export interface CountEffectsRow {
  discovered_sales: bigint | null;
  discovered_cost: bigint | null;
  discovered_unknown: boolean | null;
  unknown_shortage: bigint | null;
  reconciled_sold: bigint | null;
  surplus_cost: bigint | null;
  counts: bigint | null;
}

/**
 * The aggregate over {@link confirmedCountLines} `l` (alias required), shared with the report's
 * single profit query so both read the same rules:
 * - «اتباع» in a cashier shop (count_mode 'pos') = a discovered sale (value fixed at
 *   confirmation, FEFO cost in COGS);
 * - «اتباع» in إدارة المحل ('simple') = reconciliation of the daily totals: no revenue (the
 *   money is in the totals) and no loss;
 * - 'unknown' shortage = loss at cost; damaged / lost are NOT here (they are in waste_records,
 *   counted there once).
 */
export const COUNT_EFFECTS_SELECT = Prisma.sql`
  COALESCE(SUM(l.applied_sale_minor) FILTER (WHERE l.reason = 'unrecorded_sale' AND l.count_mode = 'pos' AND l.applied_delta_base < 0), 0)::bigint AS discovered_sales,
  COALESCE(SUM(l.applied_cost_minor) FILTER (WHERE l.reason = 'unrecorded_sale' AND l.count_mode = 'pos' AND l.applied_delta_base < 0), 0)::bigint AS discovered_cost,
  COALESCE(BOOL_OR(l.applied_cost_minor IS NULL OR l.applied_sale_minor IS NULL) FILTER (WHERE l.reason = 'unrecorded_sale' AND l.count_mode = 'pos' AND l.applied_delta_base < 0), false) AS discovered_unknown,
  COALESCE(SUM(l.applied_cost_minor) FILTER (WHERE l.reason = 'unrecorded_sale' AND l.count_mode = 'simple' AND l.applied_delta_base < 0), 0)::bigint AS reconciled_sold,
  COALESCE(SUM(l.applied_cost_minor) FILTER (WHERE (l.reason = 'unknown' OR l.reason IS NULL) AND l.applied_delta_base < 0), 0)::bigint AS unknown_shortage,
  COALESCE(SUM(l.applied_cost_minor) FILTER (WHERE l.applied_delta_base > 0), 0)::bigint AS surplus_cost,
  COUNT(DISTINCT l.session_id)::bigint AS counts`;

export function countEffectsFromRow(
  r: CountEffectsRow | undefined,
): CountEffects {
  return {
    discoveredSalesPiasters: Number(r?.discovered_sales ?? 0),
    discoveredSalesCostPiasters: Number(r?.discovered_cost ?? 0),
    discoveredSalesUnknownCost: Boolean(r?.discovered_unknown),
    unknownShortageCostPiasters: Number(r?.unknown_shortage ?? 0),
    reconciledSoldCostPiasters: Number(r?.reconciled_sold ?? 0),
    surplusCostPiasters: Number(r?.surplus_cost ?? 0),
    counts: Number(r?.counts ?? 0),
  };
}

/** The date of the last confirmed count (dashboard reminder, report completeness). */
export async function lastConfirmedCountAt(
  tx: TenantTx,
  storeId: string,
): Promise<Date | null> {
  const s = await tx.inventoryCount.findFirst({
    where: { storeId, status: "confirmed" },
    orderBy: { confirmedAt: "desc" },
    select: { confirmedAt: true },
  });
  return s?.confirmedAt ?? null;
}

/** The latest confirmed count, explained (ADR-0039): for «اسأل حسبة» — read only. */
export interface StocktakeResult {
  countId: string;
  scopeText: string;
  confirmedAt: string | null;
  salesMode: "simple" | "pos";
  counted: number;
  matched: number;
  shortageProducts: number;
  surplusProducts: number;
  topShortages: Array<{ name: string; difference: string; reason: string }>;
  topSurpluses: Array<{ name: string; difference: string }>;
  /** تالف / منتهي / مفقود at cost, as applied (known costs only). */
  lossPiasters: number;
  lossUnknownCostProducts: number;
  /** «اتباع ومتسجلش» at the selling price (الكاشير الذكي only; 0 in إدارة المحل). */
  unrecordedSalesPiasters: number;
  chart: StocktakeChartData;
}

const qtyText = (unit: string, base: number) =>
  unit === "kg"
    ? `${Number((base / 1000).toFixed(3))} كيلو`
    : `${base.toLocaleString("en-US")}`;

/**
 * The shop's latest confirmed stocktake, or null. Only this shop's (the caller's tenant
 * transaction), only numbers the server computed; nothing here changes a count or the stock.
 */
export async function lastStocktakeResultInTx(
  tx: TenantTx,
  storeId: string,
): Promise<StocktakeResult | null> {
  const last = await tx.inventoryCount.findFirst({
    where: { storeId, status: "confirmed" },
    orderBy: { confirmedAt: "desc" },
    select: { id: true },
  });
  if (!last) return null;
  const v = await viewInTx(tx, storeId, last.id);
  const diffs = v.lines.filter(
    (l) => l.differenceBase !== null && l.differenceBase !== 0,
  );
  const short = diffs
    .filter((l) => l.differenceBase! < 0)
    .sort((a, b) => a.differenceBase! - b.differenceBase!);
  const over = diffs
    .filter((l) => l.differenceBase! > 0)
    .sort((a, b) => b.differenceBase! - a.differenceBase!);
  let lossPiasters = 0;
  let lossUnknownCostProducts = 0;
  for (const l of short) {
    if (l.reason !== "damaged" && l.reason !== "expired" && l.reason !== "lost")
      continue;
    const c = l.appliedCostPiasters ?? l.differenceCostPiasters;
    if (c === null) lossUnknownCostProducts += 1;
    else lossPiasters += c;
  }
  const scopeText =
    v.scope === "category" && v.category
      ? `قسم «${v.category}»`
      : v.scope === "full"
        ? "كل المحل"
        : "منتجات معينة";
  return {
    countId: v.id,
    scopeText,
    confirmedAt: v.confirmedAt,
    salesMode: v.salesMode,
    counted: v.totals.counted,
    matched: v.totals.matched,
    shortageProducts: short.length,
    surplusProducts: over.length,
    topShortages: short.slice(0, 5).map((l) => ({
      name: l.productName,
      difference: `−${qtyText(l.unit, -l.differenceBase!)}`,
      reason: STOCKTAKE_REASON_LABEL[l.reason ?? "unknown"],
    })),
    topSurpluses: over.slice(0, 3).map((l) => ({
      name: l.productName,
      difference: `+${qtyText(l.unit, l.differenceBase!)}`,
    })),
    lossPiasters,
    lossUnknownCostProducts,
    unrecordedSalesPiasters:
      v.salesMode === "pos" ? v.totals.unrecordedSaleSellPiasters : 0,
    chart: stocktakeChartData(v.lines),
  };
}
