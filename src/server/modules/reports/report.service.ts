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
import { isServiceProduct } from "@/domain/sale-pricing";
import {
  COUNT_EFFECTS_SELECT,
  confirmedCountLines,
  countEffectsFromRow,
  type CountEffectsRow,
} from "@/server/modules/inventory";

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
    select: { id: true, nameAr: true, category: true, unit: true },
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
  /**
   * Cashier sales of SERVICES (bills, wallets, recharge…), already inside the figures above:
   * the amount the customer paid, and — for lines whose machine charge is recorded — that
   * amount and the charge. The difference is the shop's commission, not goods profit.
   */
  serviceSalesPiasters: number;
  serviceKnownRevenuePiasters: number;
  serviceKnownCostPiasters: number;
}> {
  const sales = await salesInRange(tx, storeId, from, to);
  const daily = await dailyTotalsInRange(tx, storeId, from, to);
  let revenue = 0;
  let unknownCostCount = 0;
  let knownRevenue = 0;
  let knownCost = 0;
  let serviceSales = 0;
  let serviceKnownRevenue = 0;
  let serviceKnownCost = 0;
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
      const p = l.storeProduct ?? l.storeVariant?.storeProduct ?? null;
      if (p && isServiceProduct(p)) {
        serviceSales += net.revenue;
        if (net.cost !== null) {
          serviceKnownRevenue += net.revenue;
          serviceKnownCost += net.cost;
        }
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
    serviceSalesPiasters: serviceSales,
    serviceKnownRevenuePiasters: serviceKnownRevenue,
    serviceKnownCostPiasters: serviceKnownCost,
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

/**
 * What today's stock is worth, in ONE query: the FEFO batches' remaining cost, and the stock
 * levels at the selling price with the rule of `stockValuePiasters` / a sale line (per kilo over
 * grams for `kg`, per piece otherwise; rounded once, half up) — kept equal by a unit test.
 */
export async function inventoryValueInTx(
  tx: TenantTx,
  storeId: string,
): Promise<{
  costPiasters: number;
  sellPiasters: number;
  unknownCostItems: number;
}> {
  const rows = await tx.$queryRaw<
    Array<{ cost: bigint | null; unknown: bigint; sell: bigint | null }>
  >`SELECT
      (SELECT COALESCE(SUM(ROUND(b.cost_total_minor::numeric * b.remaining_quantity_base
                                 / NULLIF(b.received_quantity_base, 0))), 0)
         FROM store_stock_batches b
        WHERE b.store_id = ${storeId}::uuid AND b.remaining_quantity_base > 0)::bigint AS cost,
      (SELECT COUNT(DISTINCT b.store_variant_id)
         FROM store_stock_batches b
        WHERE b.store_id = ${storeId}::uuid AND b.remaining_quantity_base > 0
          AND b.cost_total_minor IS NULL)::bigint AS unknown,
      (SELECT COALESCE(SUM(ROUND(v.sell_price_piasters::numeric * l.quantity_base
                                 / CASE WHEN p.unit = 'kg' THEN 1000 ELSE 1 END)), 0)
         FROM stock_levels l
         JOIN store_variants v ON v.id = l.store_variant_id
         LEFT JOIN store_products p ON p.id = v.store_product_id
        WHERE l.store_id = ${storeId}::uuid AND l.quantity_base > 0
          AND v.sell_price_piasters > 0)::bigint AS sell`;
  const r = rows[0];
  return {
    costPiasters: Number(r?.cost ?? 0),
    sellPiasters: Number(r?.sell ?? 0),
    unknownCostItems: Number(r?.unknown ?? 0),
  };
}

/**
 * Everything profit needs beyond invoices, daily totals, expenses and waste — in ONE query
 * (the Home report's round-trip budget, QA-32), plus the inventory value (one more).
 */
async function profitInputsInTx(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
) {
  const lastDay = toCairoDateString(new Date(to.getTime() - 1));
  const firstDay = from ? toCairoDateString(from) : null;
  const rows = await tx.$queryRaw<
    Array<
      CountEffectsRow & {
        svc_count: bigint;
        svc_amount: bigint;
        svc_commission: bigint;
        owner_withdrawals: bigint;
        owner_deposits: bigint;
        items_cost: bigint;
        last_count: Date | null;
      }
    >
  >`
    WITH l AS (${confirmedCountLines(storeId, from, to)}), c AS (SELECT ${COUNT_EFFECTS_SELECT} FROM l)
    SELECT c.*,
      (SELECT COUNT(*) FROM service_transactions t
        WHERE t.store_id = ${storeId}::uuid AND t.status = 'completed'
          AND t.created_at < ${to}
          AND (${from}::timestamptz IS NULL OR t.created_at >= ${from}::timestamptz))::bigint AS svc_count,
      (SELECT COALESCE(SUM(t.amount_piasters), 0) FROM service_transactions t
        WHERE t.store_id = ${storeId}::uuid AND t.status = 'completed'
          AND t.created_at < ${to}
          AND (${from}::timestamptz IS NULL OR t.created_at >= ${from}::timestamptz))::bigint AS svc_amount,
      (SELECT COALESCE(SUM(t.commission_piasters), 0) FROM service_transactions t
        WHERE t.store_id = ${storeId}::uuid AND t.status = 'completed'
          AND t.created_at < ${to}
          AND (${from}::timestamptz IS NULL OR t.created_at >= ${from}::timestamptz))::bigint AS svc_commission,
      (SELECT COALESCE(SUM(m.amount_piasters), 0) FROM money_movements m
        WHERE m.store_id = ${storeId}::uuid AND m.kind = 'owner_withdrawal'
          AND m.created_at < ${to}
          AND (${from}::timestamptz IS NULL OR m.created_at >= ${from}::timestamptz))::bigint AS owner_withdrawals,
      (SELECT COALESCE(SUM(m.amount_piasters), 0) FROM money_movements m
        WHERE m.store_id = ${storeId}::uuid AND m.kind = 'owner_deposit'
          AND m.created_at < ${to}
          AND (${from}::timestamptz IS NULL OR m.created_at >= ${from}::timestamptz))::bigint AS owner_deposits,
      (SELECT COALESCE(SUM(i.cost_minor), 0) FROM daily_sales_entry_items i
         JOIN daily_sales_entries e ON e.id = i.entry_id AND e.cancelled_at IS NULL
        WHERE i.store_id = ${storeId}::uuid
          -- The same Cairo business days as the totals themselves (dailyTotalsInRange).
          AND e.business_day <= ${lastDay}::date
          AND (${firstDay}::date IS NULL OR e.business_day >= ${firstDay}::date))::bigint AS items_cost,
      (SELECT MAX(s.confirmed_at) FROM inventory_counts s
        WHERE s.store_id = ${storeId}::uuid AND s.status = 'confirmed') AS last_count
    FROM c`;
  const r = rows[0];
  const inventoryValue = await inventoryValueInTx(tx, storeId);
  return {
    counts: countEffectsFromRow(r),
    services: {
      count: Number(r?.svc_count ?? 0),
      amountPiasters: Number(r?.svc_amount ?? 0),
      commissionPiasters: Number(r?.svc_commission ?? 0),
    },
    owner: {
      withdrawalsPiasters: Number(r?.owner_withdrawals ?? 0),
      depositsPiasters: Number(r?.owner_deposits ?? 0),
    },
    dailyItemsCostPiasters: Number(r?.items_cost ?? 0),
    inventoryValue,
    lastStocktakeAt: r?.last_count ?? null,
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
 * Net profit = goods gross profit + service commissions − operating expenses − inventory losses.
 * - Service commissions = the services page's operations (their stored commission) + the
 *   cashier's service sales (what the customer paid − what the machine paid out). A service's
 *   operation amount is never sales: a cashier service sale leaves the goods figures here.
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
  // Cashier service sales are commissions, not goods (their amount is the customer's money
  // passing through the machine).
  const cashierCommissions =
    f.serviceKnownRevenuePiasters - f.serviceKnownCostPiasters;
  const productSales = f.revenuePiasters - f.serviceSalesPiasters + discovered;
  const invoiceRevenue =
    f.revenuePiasters - f.dailyTotalsPiasters - f.serviceSalesPiasters;
  const goodsKnownCost = f.knownCostPiasters - f.serviceKnownCostPiasters;
  const invoiceCostKnown = f.unknownCostCount === 0;
  const discoveredCostKnown = !i.counts.discoveredSalesUnknownCost;
  const knownCogs =
    goodsKnownCost +
    i.dailyItemsCostPiasters +
    i.counts.discoveredSalesCostPiasters;

  // Recorded-cost gross profit: only when nothing in the period lacks a cost.
  const allCostKnown =
    invoiceCostKnown && discoveredCostKnown && f.dailyTotalsPiasters === 0;
  const gross = allCostKnown
    ? invoiceRevenue +
      discovered -
      goodsKnownCost -
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
      goodsKnownCost -
      i.counts.discoveredSalesCostPiasters;
    estimatedGross = Math.round(knownPart + f.dailyTotalsPiasters * margin);
  }

  const losses = i.wasteLossPiasters + i.counts.unknownShortageCostPiasters;
  const commissions = i.services.commissionPiasters + cashierCommissions;
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
  if (i.counts.reconciledSoldCostPiasters > 0) {
    notes.push(
      "بضاعة قلت في الجرد إنها اتباعت: فلوسها في إجمالي المبيعات اليومي، فمش محسوبة مبيعات تاني ولا خسارة.",
    );
  }
  if (cashierCommissions !== 0) {
    notes.push(
      "عمولات الخدمات من الكاشير = اللي الزبون دفعه ناقص اللي اتخصم من الماكينة (مبلغ العملية مش مبيعات).",
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
    serviceOperationsPiasters:
      i.services.amountPiasters + f.serviceKnownCostPiasters,
    operatingExpensesPiasters: i.operatingExpensesPiasters,
    inventoryLossesPiasters: losses,
    netProfitPiasters: net,
    estimatedNetProfitPiasters: estimatedNet,
    ownerWithdrawalsPiasters:
      i.owner.withdrawalsPiasters + i.ownerPersonalExpensesPiasters,
    ownerDepositsPiasters: i.owner.depositsPiasters,
    lastStocktakeAt: last ? last.toISOString() : null,
    daysSinceLastStocktake: days,
    notes,
  };
}

/**
 * «أنا كسبت كام؟» for any period inside a caller's tenant transaction — the same rules and
 * numbers as the Home report's `profit` (the AI assistant uses it).
 */
export async function periodProfitInTx(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<{
  profit: NonNullable<HomeReport["profit"]>;
  inventoryValue: NonNullable<HomeReport["inventoryValue"]>;
}> {
  const financials = await salesFinancialsInTx(tx, storeId, from, to);
  const expenses = await tx.expense.groupBy({
    by: ["category"],
    where: {
      storeId,
      deletedAt: null,
      spentAt: { ...(from ? { gte: from } : {}), lt: to },
    },
    _sum: { amountPiasters: true },
  });
  let total = 0;
  let personal = 0;
  for (const e of expenses) {
    const v = Number(e._sum.amountPiasters ?? 0);
    total += v;
    if (OWNER_PERSONAL_CATEGORIES.has(e.category)) personal += v;
  }
  const waste = await tx.wasteRecord.aggregate({
    where: { storeId, createdAt: { ...(from ? { gte: from } : {}), lt: to } },
    _sum: { costMinor: true },
  });
  const wasteUnknown = await tx.wasteRecord.count({
    where: {
      storeId,
      costMinor: BigInt(0),
      createdAt: { ...(from ? { gte: from } : {}), lt: to },
    },
  });
  const extra = await profitInputsInTx(tx, storeId, from, to);
  return {
    profit: buildProfit({
      financials,
      operatingExpensesPiasters: total - personal,
      ownerPersonalExpensesPiasters: personal,
      wasteLossPiasters: Number(waste._sum.costMinor ?? 0),
      wasteUnknownCount: wasteUnknown,
      ...extra,
    }),
    inventoryValue: extra.inventoryValue,
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
