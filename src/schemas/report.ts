import { z } from "zod";

/**
 * The Home report (`GET /api/reports/home`, ADR-0021, audit QA-06/QA-07). One shared schema:
 * the server builds this shape and the client parses it, so a field rename breaks a test
 * instead of silently showing zeros.
 *
 * Money is integer piasters. A cost or profit is `null` when it is not known from recorded
 * data — it is never estimated (no percentage of revenue, no lookup by product name).
 */

export const REPORT_PERIODS = [
  "today",
  "yesterday",
  "week",
  "month",
  "all",
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
