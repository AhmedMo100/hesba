import "server-only";

/**
 * @file report.service.ts
 * @description The Home report (ADR-0021, audit QA-06 / QA-07 / QA-08), computed on the
 * server from recorded data only:
 * - revenue: Σ `sales.total_piasters`;
 * - cost of goods sold: Σ `sale_lines.cost_piasters` — the cost recorded on each line at sale
 *   time (FEFO batch takes, sandwich snapshots, machine charges). If any sale in a group has
 *   a line without a recorded cost, the group's COGS and profit are `null` (unknown), never
 *   estimated;
 * - expenses: Σ non-deleted `expenses` by `spent_at`;
 * - purchases: Σ `store_stock_batches.cost_total_minor` of stock received in the period
 *   (batches created by a purchase or initial stock; adjustments are not purchases).
 * Periods are Cairo calendar days.
 *
 * @usedBy src/app/api/reports/home/route.ts, modules/ai (business tools)
 */

import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import {
  addDaysToDateKey,
  cairoDayStartUtc,
  cairoHour,
  toCairoDateString,
} from "@/domain/time";
import type { HomeReport, ReportPeriod } from "@/schemas/report";
import { stockValuePiasters } from "@/domain/stock/stock-value";
import {
  countEffectsInRange,
  lastConfirmedCountAt,
} from "@/server/modules/inventory";
import { serviceSummaryInRange } from "@/server/modules/services";
import { ownerMoneyInRange } from "@/server/modules/money";

const UNCATEGORIZED = "متفرقات";
const MAX_ACTIVITY = 50;
const MAX_TOP_PRODUCTS = 20;

/** The UTC range of a report period (Cairo days); `from` null = since the beginning. */
export function reportRange(
  period: ReportPeriod,
  now: Date = new Date(),
): { from: Date | null; to: Date } {
  const today = toCairoDateString(now);
  const tomorrowStart = cairoDayStartUtc(addDaysToDateKey(today, 1));
  switch (period) {
    case "today":
      return { from: cairoDayStartUtc(today), to: tomorrowStart };
    case "yesterday":
      return {
        from: cairoDayStartUtc(addDaysToDateKey(today, -1)),
        to: cairoDayStartUtc(today),
      };
    case "week":
      return {
        from: cairoDayStartUtc(addDaysToDateKey(today, -6)),
        to: tomorrowStart,
      };
    case "month":
      return {
        from: cairoDayStartUtc(addDaysToDateKey(today, -29)),
        to: tomorrowStart,
      };
    case "year":
      return {
        from: cairoDayStartUtc(addDaysToDateKey(today, -364)),
        to: tomorrowStart,
      };
    case "all":
    case "custom":
      return { from: null, to: tomorrowStart };
  }
}

/** Running revenue / cost / profit for a group of sale lines. */
class Money {
  revenue = 0;
  cost = 0;
  unknown = false;
  add(revenue: number, cost: number | null): void {
    this.revenue += revenue;
    if (cost === null) this.unknown = true;
    else this.cost += cost;
  }
  get profit(): number | null {
    return this.unknown ? null : this.revenue - this.cost;
  }
}

interface SaleRow {
  id: string;
  createdAt: Date;
  totalPiasters: bigint;
  paymentMethod: "cash" | "wallet" | "card" | "debt";
  saleLines: Array<{
    totalPiasters: bigint;
    costPiasters: bigint | null;
    quantityBaseUnits: number;
    returnLines: Array<{ quantityBase: number; amountPiasters: bigint }>;
    storeProduct: {
      id: string;
      nameAr: string | null;
      category: string | null;
    } | null;
    storeVariant: {
      storeProduct: {
        id: string;
        nameAr: string | null;
        category: string | null;
      } | null;
    } | null;
  }>;
}

/**
 * A line net of its returns (QA-31, ADR-0027): the returned value is no longer revenue, and the
 * returned share of the recorded cost is no longer COGS. Counted on the sale's date.
 */
function netLine(l: SaleRow["saleLines"][number]): {
  revenue: number;
  cost: number | null;
} {
  const returnedQty = l.returnLines.reduce((n, r) => n + r.quantityBase, 0);
  const returned = l.returnLines.reduce(
    (n, r) => n + Number(r.amountPiasters),
    0,
  );
  const kept = l.quantityBaseUnits - returnedQty;
  return {
    revenue: Number(l.totalPiasters) - returned,
    cost:
      l.costPiasters === null
        ? null
        : l.quantityBaseUnits > 0
          ? Math.round((Number(l.costPiasters) * kept) / l.quantityBaseUnits)
          : Number(l.costPiasters),
  };
}

/** A sale's revenue net of returns. */
function netSaleRevenue(s: SaleRow): number {
  return (
    Number(s.totalPiasters) -
    s.saleLines.reduce(
      (n, l) =>
        n + l.returnLines.reduce((m, r) => m + Number(r.amountPiasters), 0),
      0,
    )
  );
}

async function salesInRange(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<SaleRow[]> {
  const product = {
    select: { id: true, nameAr: true, category: true },
  } as const;
  return tx.sale.findMany({
    where: {
      storeId,
      createdAt: { ...(from ? { gte: from } : {}), lt: to },
      // A voided sale is not revenue and its cost is not COGS (ADR-0022).
      saleVoid: { is: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      totalPiasters: true,
      paymentMethod: true,
      saleLines: {
        select: {
          totalPiasters: true,
          costPiasters: true,
          quantityBaseUnits: true,
          returnLines: { select: { quantityBase: true, amountPiasters: true } },
          storeProduct: product,
          storeVariant: { select: { storeProduct: product } },
        },
      },
    },
  });
}

/**
 * Revenue and recorded cost of goods sold in a range — shared with the AI business tools so
 * both report the same numbers. `cogsPiasters` is null when any sale's cost is not recorded.
 */
export async function salesFinancialsInTx(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<{
  count: number;
  revenuePiasters: number;
  cogsPiasters: number | null;
  grossProfitPiasters: number | null;
  unknownCostCount: number;
  knownCostRevenuePiasters: number;
  knownCostPiasters: number;
  dailyTotalsCount: number;
  dailyTotalsPiasters: number;
  dailyTotalsCashPiasters: number;
  dailyTotalsCreditPiasters: number;
}> {
  const sales = await salesInRange(tx, storeId, from, to);
  const daily = await dailyTotalsInRange(tx, storeId, from, to);
  let revenue = 0;
  let unknownCostCount = 0;
  let knownRevenue = 0;
  let knownCost = 0;
  for (const s of sales) {
    revenue += netSaleRevenue(s);
    const lines = s.saleLines;
    const known =
      lines.length > 0 && lines.every((l) => l.costPiasters !== null);
    if (!known) unknownCostCount += 1;
    for (const l of lines) {
      const net = netLine(l);
      if (net.cost !== null) {
        knownRevenue += net.revenue;
        knownCost += net.cost;
      }
    }
  }
  // إدارة المحل's daily totals are revenue too, but with no cost per item: profit is unknown
  // (never guessed from the stock) while any of them is in the period (ADR-0033).
  const cogs = unknownCostCount === 0 && daily.count === 0 ? knownCost : null;
  const total = revenue + daily.totalPiasters;
  return {
    count: sales.length,
    revenuePiasters: total,
    cogsPiasters: cogs,
    grossProfitPiasters: cogs === null ? null : total - cogs,
    unknownCostCount,
    knownCostRevenuePiasters: knownRevenue,
    knownCostPiasters: knownCost,
    dailyTotalsCount: daily.count,
    dailyTotalsPiasters: daily.totalPiasters,
    dailyTotalsCashPiasters: daily.cashPiasters,
    dailyTotalsCreditPiasters: daily.creditPiasters,
  };
}

/**
 * The daily sales totals (إدارة المحل) whose Cairo business day falls in [from, to); cancelled
 * ones count nowhere. Shared with the AI business tools (same numbers as the reports).
 */
export async function dailyTotalsInRange(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<{
  count: number;
  totalPiasters: number;
  cashPiasters: number;
  creditPiasters: number;
}> {
  const lastDay = toCairoDateString(new Date(to.getTime() - 1));
  const firstDay = from ? toCairoDateString(from) : null;
  const agg = await tx.dailySalesEntry.aggregate({
    where: {
      storeId,
      cancelledAt: null,
      businessDay: {
        ...(firstDay ? { gte: new Date(`${firstDay}T00:00:00Z`) } : {}),
        lte: new Date(`${lastDay}T00:00:00Z`),
      },
    },
    _sum: { totalPiasters: true, cashPiasters: true, creditPiasters: true },
    _count: true,
  });
  return {
    count: agg._count,
    totalPiasters: Number(agg._sum.totalPiasters ?? 0),
    cashPiasters: Number(agg._sum.cashPiasters ?? 0),
    creditPiasters: Number(agg._sum.creditPiasters ?? 0),
  };
}

/** Expense categories that are the owner's own spending: shown apart, never operating cost. */
export const OWNER_PERSONAL_CATEGORIES: ReadonlySet<string> = new Set([
  "مصاريف شخصية",
]);

/** What today's stock is worth: FEFO batches at cost, stock levels at the selling price. */
export async function inventoryValueInTx(
  tx: TenantTx,
  storeId: string,
): Promise<{
  costPiasters: number;
  sellPiasters: number;
  unknownCostItems: number;
}> {
  const cost = await tx.$queryRaw<
    Array<{ cost: bigint | null; unknown: bigint }>
  >`SELECT COALESCE(SUM(ROUND(b.cost_total_minor::numeric * b.remaining_quantity_base
                         / NULLIF(b.received_quantity_base, 0))), 0)::bigint AS cost,
           COUNT(DISTINCT b.store_variant_id) FILTER (WHERE b.cost_total_minor IS NULL)::bigint AS unknown
      FROM store_stock_batches b
     WHERE b.store_id = ${storeId}::uuid AND b.remaining_quantity_base > 0`;
  const levels = await tx.stockLevel.findMany({
    where: { storeId, quantityBase: { gt: BigInt(0) } },
    select: {
      quantityBase: true,
      storeVariant: {
        select: {
          sellPricePiasters: true,
          storeProduct: { select: { unit: true } },
        },
      },
    },
  });
  let sell = 0;
  for (const l of levels) {
    sell += stockValuePiasters(
      l.storeVariant.storeProduct?.unit ?? "piece",
      Number(l.quantityBase),
      Number(l.storeVariant.sellPricePiasters),
    );
  }
  return {
    costPiasters: Number(cost[0]?.cost ?? 0),
    sellPiasters: sell,
    unknownCostItems: Number(cost[0]?.unknown ?? 0),
  };
}

/** Everything profit needs beyond invoices, daily totals, expenses and waste. */
async function profitInputsInTx(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
) {
  const counts = await countEffectsInRange(tx, storeId, from, to);
  const services = await serviceSummaryInRange(tx, storeId, from, to);
  const owner = await ownerMoneyInRange(tx, storeId, from, to);
  const dailyItems = await tx.dailySalesEntryItem.aggregate({
    where: {
      storeId,
      createdAt: { ...(from ? { gte: from } : {}), lt: to },
      entry: { cancelledAt: null },
    },
    _sum: { costMinor: true },
  });
  const inventoryValue = await inventoryValueInTx(tx, storeId);
  const last = await lastConfirmedCountAt(tx, storeId);
  return {
    counts,
    services,
    owner,
    dailyItemsCostPiasters: Number(dailyItems._sum.costMinor ?? 0),
    inventoryValue,
    lastStocktakeAt: last,
  };
}

type ProfitInputs = Awaited<ReturnType<typeof profitInputsInTx>> & {
  financials: Awaited<ReturnType<typeof salesFinancialsInTx>>;
  operatingExpensesPiasters: number;
  ownerPersonalExpensesPiasters: number;
  wasteLossPiasters: number;
  wasteUnknownCount: number;
};

/**
 * Net profit = gross profit + service commissions − operating expenses − inventory losses.
 * - Actual: every product sale has a recorded cost (no daily totals in the period).
 * - Estimated: daily totals (إدارة المحل) have no cost per item; their gross profit is valued
 *   at the margin of the shop's own stock today (selling vs cost value) — labelled as such.
 * - Incomplete: no basis for the estimate (no stock with both prices), or invoices without cost.
 * Stocktake: «اتباع ومتسجلش» is a sale (its FEFO cost in COGS), an unexplained shortage is a
 * loss, damaged / lost goods are losses once (waste_records). Collections, supplier payments,
 * transfers, owner withdrawals / deposits and a service's operation amount are never here.
 */
export function buildProfit(
  i: ProfitInputs,
): NonNullable<HomeReport["profit"]> {
  const f = i.financials;
  const notes: string[] = [];
  const discovered = i.counts.discoveredSalesPiasters;
  const productSales = f.revenuePiasters + discovered;
  const invoiceRevenue = f.revenuePiasters - f.dailyTotalsPiasters;
  const invoiceCostKnown = f.unknownCostCount === 0;
  const discoveredCostKnown = !i.counts.discoveredSalesUnknownCost;
  const knownCogs =
    f.knownCostPiasters +
    i.dailyItemsCostPiasters +
    i.counts.discoveredSalesCostPiasters;

  // Recorded-cost gross profit: only when nothing in the period lacks a cost.
  const allCostKnown =
    invoiceCostKnown && discoveredCostKnown && f.dailyTotalsPiasters === 0;
  const gross = allCostKnown
    ? invoiceRevenue +
      discovered -
      f.knownCostPiasters -
      i.counts.discoveredSalesCostPiasters
    : null;

  // The estimate's margin: the shop's own stock, selling vs cost value.
  const inv = i.inventoryValue;
  const margin =
    inv.sellPiasters > 0 &&
    inv.costPiasters > 0 &&
    inv.costPiasters < inv.sellPiasters
      ? (inv.sellPiasters - inv.costPiasters) / inv.sellPiasters
      : null;
  let estimatedGross: number | null = null;
  if (gross !== null) {
    estimatedGross = gross;
  } else if (invoiceCostKnown && discoveredCostKnown && margin !== null) {
    const knownPart =
      invoiceRevenue +
      discovered -
      f.knownCostPiasters -
      i.counts.discoveredSalesCostPiasters;
    estimatedGross = Math.round(knownPart + f.dailyTotalsPiasters * margin);
  }

  const losses = i.wasteLossPiasters + i.counts.unknownShortageCostPiasters;
  const commissions = i.services.commissionPiasters;
  const net =
    gross === null
      ? null
      : gross + commissions - i.operatingExpensesPiasters - losses;
  const estimatedNet =
    estimatedGross === null
      ? null
      : estimatedGross + commissions - i.operatingExpensesPiasters - losses;

  if (f.dailyTotalsPiasters > 0) {
    notes.push(
      margin !== null
        ? `مبيعات اليوم المتسجلة كإجمالي (${f.dailyTotalsCount}) مالهاش تكلفة لكل صنف: مكسبها محسوب تقديري بهامش بضاعتك الحالية (${Math.round(margin * 100)}%).`
        : "مبيعات اليوم المتسجلة كإجمالي مالهاش تكلفة لكل صنف، ومفيش أسعار شراء كفاية لتقدير المكسب.",
    );
  }
  if (!invoiceCostKnown) {
    notes.push(`${f.unknownCostCount} فاتورة بيع تكلفة بضاعتها مش متسجلة.`);
  }
  if (!discoveredCostKnown) {
    notes.push("مبيعات اكتشفها الجرد ليها أصناف من غير تكلفة.");
  }
  if (i.wasteUnknownCount > 0) {
    notes.push(
      `${i.wasteUnknownCount} حالة تالف تكلفتها مش متسجلة (مش محسوبة في الخسارة).`,
    );
  }
  if (discovered > 0) {
    notes.push(
      "فيه مبيعات أكدتها في الجرد (اتباعت ومتسجلتش): محسوبة بسعر البيع.",
    );
  }
  if (i.counts.unknownShortageCostPiasters > 0) {
    notes.push("فيه عجز في الجرد سببه مش معروف: محسوب كخسارة، مش كمبيعات.");
  }
  const last = i.lastStocktakeAt;
  const days = last
    ? Math.floor((Date.now() - last.getTime()) / 86_400_000)
    : null;
  if (days === null)
    notes.push("لسه ما اتعملش جرد: المخزون والمكسب ممكن يكونوا مش دقيقين.");
  else if (days > 30) notes.push(`آخر جرد من ${days} يوم: يستحسن تعمل جرد.`);
  if (i.ownerPersonalExpensesPiasters > 0) {
    notes.push("المصاريف الشخصية مش محسوبة من مصاريف المحل (اتحسبت مسحوبات).");
  }

  return {
    status:
      gross !== null
        ? "actual"
        : estimatedGross !== null
          ? "estimated"
          : "incomplete",
    productSalesPiasters: productSales,
    discoveredSalesPiasters: discovered,
    knownCogsPiasters: knownCogs,
    grossProfitPiasters: gross,
    estimatedGrossProfitPiasters: estimatedGross,
    estimateMarginPercent:
      margin === null ? null : Math.round(margin * 1000) / 10,
    serviceCommissionsPiasters: commissions,
    serviceOperationsPiasters: i.services.amountPiasters,
    operatingExpensesPiasters: i.operatingExpensesPiasters,
    inventoryLossesPiasters: losses,
    netProfitPiasters: net,
    estimatedNetProfitPiasters: estimatedNet,
    ownerWithdrawalsPiasters:
      i.owner.withdrawalsPiasters + i.ownerPersonalExpensesPiasters,
    ownerDepositsPiasters: i.owner.depositsPiasters,
    lastStocktakeAt: last ? last.toISOString() : null,
    notes,
  };
}

/** Builds the Home report for one period of one store. */
export async function getHomeReport(
  storeId: string,
  userId: string,
  period: ReportPeriod,
  opts: { now?: Date; customFrom?: string; customTo?: string } = {},
): Promise<HomeReport> {
  const now = opts.now ?? new Date();
  let { from, to } = reportRange(period, now);
  if (period === "custom" && opts.customFrom) {
    from = cairoDayStartUtc(opts.customFrom);
    to = cairoDayStartUtc(
      addDaysToDateKey(opts.customTo || opts.customFrom, 1),
    );
  }
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const sales = await salesInRange(tx, storeId, from, to);
      const financials = await salesFinancialsInTx(tx, storeId, from, to);

      const expenses = await tx.expense.findMany({
        where: {
          storeId,
          deletedAt: null,
          spentAt: { ...(from ? { gte: from } : {}), lt: to },
        },
        orderBy: { spentAt: "asc" },
        select: {
          id: true,
          category: true,
          amountPiasters: true,
          note: true,
          spentAt: true,
        },
      });

      const purchases = await tx.$queryRaw<
        Array<{ total: bigint | null; count: bigint; unknown: bigint }>
      >`SELECT COALESCE(SUM(b.cost_total_minor), 0)::bigint AS total,
               COUNT(*)::bigint AS count,
               COUNT(*) FILTER (WHERE b.cost_total_minor IS NULL)::bigint AS unknown
          FROM store_stock_batches b
         WHERE b.store_id = ${storeId}::uuid
           AND b.received_at < ${to}
           AND (${from}::timestamptz IS NULL OR b.received_at >= ${from}::timestamptz)
           AND EXISTS (SELECT 1 FROM stock_movements m
                        WHERE m.batch_id = b.id
                          AND m.type IN ('purchase', 'initial_stock'))`;

      // Damaged / lost goods (P4): each waste record once, its cost from the batches taken.
      const lossRows = await tx.$queryRaw<
        Array<{
          id: string;
          created_at: Date;
          reason: string;
          note: string | null;
          quantity_base: bigint;
          cost_minor: bigint;
          cost_unknown: boolean;
          name: string | null;
          unit: string | null;
        }>
      >`SELECT w.id::text AS id, w.created_at, w.reason, w.note, w.quantity_base,
               w.cost_minor,
               EXISTS (SELECT 1 FROM stock_movements m
                        WHERE m.waste_id = w.id AND m.cost_price_minor IS NULL) AS cost_unknown,
               p.name_ar AS name, p.unit
          FROM waste_records w
          JOIN store_variants v ON v.id = w.store_variant_id
          LEFT JOIN store_products p ON p.id = v.store_product_id
         WHERE w.store_id = ${storeId}::uuid
           AND w.created_at < ${to}
           AND (${from}::timestamptz IS NULL OR w.created_at >= ${from}::timestamptz)
         ORDER BY w.created_at DESC`;
      const byReason = new Map<string, { count: number; cost: number }>();
      let lossCost = 0;
      let lossUnknown = 0;
      for (const r of lossRows) {
        const cost = r.cost_unknown ? 0 : Number(r.cost_minor);
        if (r.cost_unknown) lossUnknown += 1;
        lossCost += cost;
        const g = byReason.get(r.reason) ?? { count: 0, cost: 0 };
        g.count += 1;
        g.cost += cost;
        byReason.set(r.reason, g);
      }
      const losses: HomeReport["losses"] = {
        count: lossRows.length,
        costPiasters: lossCost,
        unknownCostCount: lossUnknown,
        byReason: [...byReason.entries()]
          .map(([reason, g]) => ({
            reason,
            count: g.count,
            costPiasters: g.cost,
          }))
          .sort((a, b) => b.costPiasters - a.costPiasters),
        recent: lossRows.slice(0, 5).map((r) => ({
          id: r.id,
          at: r.created_at.toISOString(),
          name: r.name ?? "",
          unit: r.unit ?? "piece",
          quantityBase: Number(r.quantity_base),
          reason: r.reason,
          note: r.note,
          costPiasters: r.cost_unknown ? null : Number(r.cost_minor),
        })),
      };

      // Series, products and categories — sums of recorded line values per group.
      const granularity: "hour" | "day" =
        period === "today" || period === "yesterday" ? "hour" : "day";
      const buckets = new Map<string, Money>();
      if (granularity === "hour") {
        for (let h = 8; h <= 23; h++) buckets.set(String(h), new Money());
      } else if (from) {
        const days = period === "week" ? 7 : 30;
        for (let i = 0; i < days; i++) {
          buckets.set(
            addDaysToDateKey(toCairoDateString(from), i),
            new Money(),
          );
        }
      }
      const products = new Map<
        string,
        { productId: string | null; name: string; qty: number; money: Money }
      >();
      const categories = new Map<string, Money>();
      // Net sales (after returns) by how they were paid; a credit sale counts as «آجل».
      const byPaymentMethod = { cash: 0, wallet: 0, card: 0, debt: 0 };
      for (const s of sales) {
        byPaymentMethod[s.paymentMethod] += netSaleRevenue(s);
      }
      // Daily totals (إدارة المحل): their cash part and their wallet parts.
      byPaymentMethod.cash += financials.dailyTotalsCashPiasters;
      byPaymentMethod.debt += financials.dailyTotalsCreditPiasters;
      byPaymentMethod.wallet +=
        financials.dailyTotalsPiasters -
        financials.dailyTotalsCashPiasters -
        financials.dailyTotalsCreditPiasters;

      for (const s of sales) {
        const key =
          granularity === "hour"
            ? String(cairoHour(s.createdAt))
            : toCairoDateString(s.createdAt);
        const bucket = buckets.get(key) ?? new Money();
        buckets.set(key, bucket);
        if (s.saleLines.length === 0) {
          bucket.add(Number(s.totalPiasters), null);
          continue;
        }
        for (const l of s.saleLines) {
          const product = l.storeVariant?.storeProduct ?? l.storeProduct;
          const { revenue, cost } = netLine(l);
          bucket.add(revenue, cost);

          const pKey = product?.id ?? "unknown";
          const p = products.get(pKey) ?? {
            productId: product?.id ?? null,
            name: product?.nameAr ?? "",
            qty: 0,
            money: new Money(),
          };
          p.qty +=
            l.quantityBaseUnits -
            l.returnLines.reduce((n, r) => n + r.quantityBase, 0);
          p.money.add(revenue, cost);
          products.set(pKey, p);

          const cat = product?.category || UNCATEGORIZED;
          const c = categories.get(cat) ?? new Money();
          c.add(revenue, cost);
          categories.set(cat, c);
        }
      }

      const activity: HomeReport["activity"] = [
        ...sales.map((s) => ({
          id: s.id,
          kind: "sale" as const,
          at: s.createdAt.toISOString(),
          label: [
            ...new Set(
              s.saleLines.map(
                (l) =>
                  (l.storeVariant?.storeProduct ?? l.storeProduct)?.nameAr ??
                  "",
              ),
            ),
          ]
            .filter(Boolean)
            .join(" · "),
          note: null,
          amountPiasters: Number(s.totalPiasters),
        })),
        ...expenses.map((e) => ({
          id: e.id,
          kind: "expense" as const,
          at: e.spentAt.toISOString(),
          label: e.category,
          note: e.note,
          amountPiasters: -Number(e.amountPiasters),
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, MAX_ACTIVITY);

      const purchaseRow = purchases[0];
      const expenseTotal = expenses.reduce(
        (t, e) => t + Number(e.amountPiasters),
        0,
      );
      const personal = expenses
        .filter((e) => OWNER_PERSONAL_CATEGORIES.has(e.category))
        .reduce((t, e) => t + Number(e.amountPiasters), 0);
      const extra = await profitInputsInTx(tx, storeId, from, to);
      const profit = buildProfit({
        financials,
        operatingExpensesPiasters: expenseTotal - personal,
        ownerPersonalExpensesPiasters: personal,
        wasteLossPiasters: lossCost,
        wasteUnknownCount: lossUnknown,
        ...extra,
      });
      return {
        period,
        from: from ? from.toISOString() : null,
        to: to.toISOString(),
        sales: financials,
        expenses: {
          count: expenses.length,
          totalPiasters: expenses.reduce(
            (t, e) => t + Number(e.amountPiasters),
            0,
          ),
        },
        losses,
        purchases: {
          totalPiasters: Number(purchaseRow?.total ?? 0),
          count: Number(purchaseRow?.count ?? 0),
          unknownCostCount: Number(purchaseRow?.unknown ?? 0),
        },
        series: {
          granularity,
          points: [...buckets.entries()]
            .sort(([a], [b]) =>
              granularity === "hour"
                ? Number(a) - Number(b)
                : a.localeCompare(b),
            )
            .map(([key, m]) => ({
              key,
              revenuePiasters: m.revenue,
              grossProfitPiasters: m.profit,
            })),
        },
        topProducts: [...products.values()]
          .sort((a, b) => b.money.revenue - a.money.revenue)
          .slice(0, MAX_TOP_PRODUCTS)
          .map((p) => ({
            productId: p.productId,
            name: p.name,
            quantityBase: p.qty,
            revenuePiasters: p.money.revenue,
            grossProfitPiasters: p.money.profit,
          })),
        byCategory: [...categories.entries()]
          .sort(([, a], [, b]) => b.revenue - a.revenue)
          .map(([category, m]) => ({
            category,
            revenuePiasters: m.revenue,
            grossProfitPiasters: m.profit,
          })),
        byPaymentMethod,
        profit,
        inventoryValue: extra.inventoryValue,
        activity,
      };
    },
    prisma,
  );
}
