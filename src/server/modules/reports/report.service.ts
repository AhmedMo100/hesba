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
    case "all":
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
}> {
  const sales = await salesInRange(tx, storeId, from, to);
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
  const cogs = unknownCostCount === 0 ? knownCost : null;
  return {
    count: sales.length,
    revenuePiasters: revenue,
    cogsPiasters: cogs,
    grossProfitPiasters: cogs === null ? null : revenue - cogs,
    unknownCostCount,
    knownCostRevenuePiasters: knownRevenue,
    knownCostPiasters: knownCost,
  };
}

/** Builds the Home report for one period of one store. */
export async function getHomeReport(
  storeId: string,
  userId: string,
  period: ReportPeriod,
  now: Date = new Date(),
): Promise<HomeReport> {
  const { from, to } = reportRange(period, now);
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
        activity,
      };
    },
    prisma,
  );
}
