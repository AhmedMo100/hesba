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
 *   - `unrecorded_sale` («اتباع ومتسجلش»): stock out with its FEFO cost; its value at the
 *     selling price is a sale DISCOVERED by the count — no payment method, no customer, no
 *     money movement (the money is wherever the drawer count says).
 *   - `damaged` («تالف») / `lost` («ضايع / مسروق»): a loss, recorded in `waste_records` (the
 *     existing loss ledger, so the reports count it once).
 *   - `unknown` («مش عارف»), the default: stock out, reported as an unexplained difference.
 * - A surplus (`surplus`) goes back into stock as a batch at the known cost; it is not a purchase
 *   and moves no money.
 * - Confirmation is atomic and idempotent (`confirm_op_id`); an abandoned count changes nothing.
 *   A closed count is frozen by the database (trigger).
 */

import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { isServiceProduct } from "@/domain/sale-pricing";
import { totalFromUnitCost } from "@/domain/stock/batch-cost";
import type {
  CountReason,
  StartInventoryCountInput,
  UpdateInventoryCountInput,
} from "@/schemas/inventory-count";
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
  lostBase: number;
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
    orderBy: { createdAt: "asc" },
    include: {
      storeVariant: {
        select: {
          id: true,
          packQty: true,
          flavor: true,
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

function totalsOf(lines: InventoryCountLineView[]): InventoryCountTotals {
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
    lostBase: 0,
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
      t.surplusBase += l.differenceBase;
      t.surplusCostPiasters += cost;
      continue;
    }
    const q = -l.differenceBase;
    t.shortageBase += q;
    t.shortageCostPiasters += cost;
    const reason = l.reason ?? "unknown";
    if (reason === "damaged") t.damagedBase += q;
    else if (reason === "lost") t.lostBase += q;
    else if (reason === "unrecorded_sale") {
      t.unrecordedSaleBase += q;
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
  });
  if (!s) throw AppError.notFound("الجرد ده مش موجود");
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
    totals: totalsOf(lines),
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
    return {
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
          data: { countedBase: null, reason: null, updatedAt: now },
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
          updatedAt: now,
        },
      });
    }
    return viewInTx(tx, storeId, id);
  });
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
      data: { status: "abandoned", abandonedAt: new Date() },
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
        if (reason === "damaged" || reason === "lost") {
          const w = await recordWasteInTx(tx, storeId, {
            storeVariantId: variantId,
            quantityBase: qty,
            reason: reason === "damaged" ? "damaged" : "missing",
            note: `جرد ${now.toISOString().slice(0, 10)}`,
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
            now,
          });
          appliedCost = taken.costPiasters;
        }
      }
      await tx.inventoryCountLine.update({
        where: { id: l.id },
        data: {
          appliedDeltaBase: diff,
          appliedCostMinor: appliedCost,
          updatedAt: now,
        },
      });
    }
    await tx.inventoryCount.update({
      where: { id },
      data: { status: "confirmed", confirmOpId: opId, confirmedAt: now },
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
): Promise<{
  discoveredSalesPiasters: number;
  discoveredSalesCostPiasters: number;
  discoveredSalesUnknownCost: boolean;
  unknownShortageCostPiasters: number;
  surplusCostPiasters: number;
  counts: number;
}> {
  const lines = await tx.inventoryCountLine.findMany({
    where: {
      storeId,
      session: {
        status: "confirmed",
        confirmedAt: { ...(from ? { gte: from } : {}), lt: to },
      },
      appliedDeltaBase: { not: ZERO },
    },
    select: {
      sessionId: true,
      appliedDeltaBase: true,
      appliedCostMinor: true,
      reason: true,
      unitPriceMinor: true,
      storeVariant: { select: { storeProduct: { select: { unit: true } } } },
    },
  });
  let sales = 0;
  let salesCost = 0;
  let unknownCost = false;
  let shortage = 0;
  let surplus = 0;
  for (const l of lines) {
    const d = l.appliedDeltaBase ?? ZERO;
    const cost =
      l.appliedCostMinor === null ? null : Number(l.appliedCostMinor);
    if (d > ZERO) {
      surplus += cost ?? 0;
      continue;
    }
    if (l.reason === "unrecorded_sale") {
      sales +=
        valueOf(
          l.unitPriceMinor,
          -d,
          l.storeVariant.storeProduct?.unit ?? "piece",
        ) ?? 0;
      if (cost === null) unknownCost = true;
      else salesCost += cost;
    } else if (l.reason === "unknown" || l.reason === null) {
      shortage += cost ?? 0;
    }
  }
  return {
    discoveredSalesPiasters: sales,
    discoveredSalesCostPiasters: salesCost,
    discoveredSalesUnknownCost: unknownCost,
    unknownShortageCostPiasters: shortage,
    surplusCostPiasters: surplus,
    counts: new Set(lines.map((l) => l.sessionId)).size,
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
