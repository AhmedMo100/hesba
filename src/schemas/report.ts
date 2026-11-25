import { z } from "zod";

/**
 * The Home report (`GET /api/reports/home`, ADR-0021, audit QA-06/QA-07). One shared schema:
 * the server builds this shape and the client parses it, so a field rename breaks a test
 * instead of silently showing zeros.
 *
 * Money is integer piasters. A cost or profit is `null` when it is not known from recorded
 * data — never guessed (no percentage of revenue, no lookup by product name). The one estimate,
 * `profit.estimatedGrossProfitPiasters` / `estimatedNetProfitPiasters` (daily totals valued at
 * the shop's own stock margin), is a separate field and is labelled: `profit.status` is
 * `actual` | `estimated` | `incomplete`, with the reasons in `profit.notes` (ADR-0034).
 */

export const REPORT_PERIODS = [
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "all",
  "custom",
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const piasters = z.number().int();
const maybePiasters = piasters.nullable();

export const homeReportSchema = z.object({
  period: z.enum(REPORT_PERIODS),
  /** Start of the period (UTC ISO), null for "all". */
  from: z.string().nullable(),
  /** End of the period (exclusive, UTC ISO). */
  to: z.string(),
  sales: z.object({
    count: z.number().int().min(0),
    revenuePiasters: piasters,
    /** Σ recorded line costs; null when any sale in the period has an unknown cost. */
    cogsPiasters: maybePiasters,
    /** revenue − COGS; null when COGS is unknown. */
    grossProfitPiasters: maybePiasters,
    /** Sales whose cost is not recorded (they make COGS and profit unknown). */
    unknownCostCount: z.number().int().min(0),
    /** The part of revenue whose cost IS recorded, and that cost (for an honest partial view). */
    knownCostRevenuePiasters: piasters,
    knownCostPiasters: piasters,
    /** إدارة المحل's daily sales totals in the period (included in revenue; no cost known). */
    dailyTotalsCount: z.number().int().min(0).default(0),
    dailyTotalsPiasters: piasters.default(0),
    dailyTotalsCashPiasters: piasters.default(0),
    /** The part of the daily totals sold on credit (آجل): revenue, not cash. */
    dailyTotalsCreditPiasters: piasters.default(0),
    /**
     * Services sold at the cashier (bills, recharge, wallets), INSIDE the revenue above: what
     * the customers paid. Only the commission is profit (`profit.serviceCommissionsPiasters`),
     * so the screens show this part apart from goods sales.
     */
    serviceSalesPiasters: piasters.default(0),
  }),
  expenses: z.object({
    count: z.number().int().min(0),
    totalPiasters: piasters,
  }),
  purchases: z.object({
    /** Σ recorded batch totals of stock received in the period (purchases + initial stock). */
    totalPiasters: piasters,
    count: z.number().int().min(0),
    /** Batches received without a recorded cost (not included in the total). */
    unknownCostCount: z.number().int().min(0),
  }),
  series: z.object({
    granularity: z.enum(["hour", "day"]),
    points: z.array(
      z.object({
        /** Cairo hour "0".."23", or Cairo date "YYYY-MM-DD". */
        key: z.string(),
        revenuePiasters: piasters,
        grossProfitPiasters: maybePiasters,
      }),
    ),
  }),
  topProducts: z.array(
    z.object({
      productId: z.string().nullable(),
      name: z.string(),
      quantityBase: z.number().int(),
      revenuePiasters: piasters,
      grossProfitPiasters: maybePiasters,
    }),
  ),
  byCategory: z.array(
    z.object({
      category: z.string(),
      revenuePiasters: piasters,
      grossProfitPiasters: maybePiasters,
    }),
  ),
  /**
   * Damaged / lost goods in the period (P4), from `waste_records`. Quantities stay per record
   * in their own unit (grams vs pieces cannot be added up); the cost is the batches' recorded
   * cost of what was taken, null-free: records with an unknown cost are counted apart.
   */
  losses: z.object({
    count: z.number().int().min(0),
    costPiasters: piasters,
    unknownCostCount: z.number().int().min(0),
    byReason: z.array(
      z.object({
        reason: z.string(),
        count: z.number().int().min(0),
        costPiasters: piasters,
      }),
    ),
    recent: z.array(
      z.object({
        id: z.string(),
        at: z.string(),
        name: z.string(),
        unit: z.string(),
        quantityBase: z.number().int(),
        reason: z.string(),
        note: z.string().nullable(),
        /** null = the batch cost is not recorded. */
        costPiasters: maybePiasters,
      }),
    ),
  }),
  /** Net sales of the period by how they were paid (additive; absent in older answers). */
  byPaymentMethod: z
    .object({
      cash: piasters,
      wallet: piasters,
      card: piasters,
      debt: piasters,
    })
    .optional(),
  /**
   * «أنا كسبت كام؟» (additive). Every number is labelled: `actual` = from recorded costs only;
   * `estimated` = part of it rests on an estimate (named in `notes`); `incomplete` = not enough
   * data to say. Collections, supplier payments, transfers and owner withdrawals are never
   * income or expenses here; a service counts only its commission.
   */
  profit: z
    .object({
      status: z.enum(["actual", "estimated", "incomplete"]),
      /**
       * Goods: invoices + daily totals + sales a cashier shop confirmed in a stocktake. Service
       * sales are NOT here (their margin is a commission below).
       */
      productSalesPiasters: piasters,
      discoveredSalesPiasters: piasters,
      /** Cost of goods sold where it is recorded (invoices, quantities, stocktake sales). */
      knownCogsPiasters: piasters,
      /** Gross profit from recorded costs only; null when part of the sales has no cost. */
      grossProfitPiasters: maybePiasters,
      /** Gross profit with the daily totals valued at the shop's own stock margin. */
      estimatedGrossProfitPiasters: maybePiasters,
      /** The margin used for that estimate (selling vs cost value of today's stock), %. */
      estimateMarginPercent: z.number().nullable(),
      /**
       * The services page's commissions + the cashier's service sales (paid − machine charge):
       * the only income from services.
       */
      serviceCommissionsPiasters: piasters,
      /** The operations' own amounts (money passing through the machines): never income. */
      serviceOperationsPiasters: piasters,
      /** Operating expenses (owner's personal spending excluded). */
      operatingExpensesPiasters: piasters,
      /** Damaged / lost / expired goods + unexplained stocktake shortages, at cost. */
      inventoryLossesPiasters: piasters,
      netProfitPiasters: maybePiasters,
      estimatedNetProfitPiasters: maybePiasters,
      /** Shown apart, never in profit. */
      ownerWithdrawalsPiasters: piasters,
      ownerDepositsPiasters: piasters,
      lastStocktakeAt: z.string().nullable(),
      /** Whole days since the last confirmed stocktake (server clock); null = never. */
      daysSinceLastStocktake: z.number().int().nullable(),
      notes: z.array(z.string()),
    })
    .optional(),
  /** What today's stock is worth (not cash): at cost (FEFO batches) and at selling prices. */
  inventoryValue: z
    .object({
      costPiasters: piasters,
      sellPiasters: piasters,
      /** Products in stock with no recorded cost (left out of `costPiasters`). */
      unknownCostItems: z.number().int().min(0),
    })
    .optional(),
  activity: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["sale", "expense"]),
      at: z.string(),
      /** Sale: the sold items' names; expense: its category. */
      label: z.string(),
      note: z.string().nullable(),
      /** Sales positive, expenses negative. */
      amountPiasters: piasters,
    }),
  ),
});

export type HomeReport = z.infer<typeof homeReportSchema>;

/** A real calendar day written YYYY-MM-DD (a custom report range's end). */
const reportDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح")
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, "التاريخ غير صحيح");

/** `from` / `to` of a custom report range: real days, the start not after the end. */
export const reportRangeQuerySchema = z
  .object({ from: reportDay.optional(), to: reportDay.optional() })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: "بداية الفترة بعد نهايتها",
    path: ["from"],
  });
