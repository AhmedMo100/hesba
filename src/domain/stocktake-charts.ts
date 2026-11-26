/**
 * @file stocktake-charts.ts
 * @description What the stocktake's charts show (ADR-0039), built from a count's lines — shared
 * by the «الجرد» screen and «اسأل حسبة» (whose chart is built on the server from the shop's own
 * count, never written by the model). Pure: no React, no database.
 *
 * - `status`: products counted right (مظبوط), over (زيادة), short (ناقص).
 * - `pairs`: the products with the biggest differences, what Hesba held next to what was counted
 *   (one product, one unit, so the two bars compare).
 * - `reasons`: how many short products each reason explains.
 */

export type StocktakeReason =
  "unrecorded_sale" | "damaged" | "expired" | "lost" | "unknown" | "surplus";

export const STOCKTAKE_REASON_LABEL: Record<StocktakeReason, string> = {
  unrecorded_sale: "اتباع ومتسجلش",
  damaged: "تالف",
  expired: "منتهي الصلاحية",
  lost: "مفقود",
  unknown: "سبب آخر",
  surplus: "زيادة",
};

export interface StocktakeChartLine {
  productName: string;
  unit: string;
  expectedBase: number;
  countedBase: number | null;
  differenceBase: number | null;
  reason: StocktakeReason | null;
}

export interface StocktakeChartData {
  status: { ok: number; over: number; short: number };
  pairs: Array<{
    name: string;
    unit: string;
    expectedBase: number;
    countedBase: number;
  }>;
  reasons: Array<{ reason: StocktakeReason; label: string; products: number }>;
}

const SHORT_REASONS: StocktakeReason[] = [
  "unrecorded_sale",
  "damaged",
  "lost",
  "expired",
  "unknown",
];

export function stocktakeChartData(
  lines: StocktakeChartLine[],
  pairCount = 6,
): StocktakeChartData {
  const status = { ok: 0, over: 0, short: 0 };
  const byReason = new Map<StocktakeReason, number>();
  for (const l of lines) {
    if (l.countedBase === null || l.differenceBase === null) continue;
    if (l.differenceBase === 0) status.ok += 1;
    else if (l.differenceBase > 0) status.over += 1;
    else {
      status.short += 1;
      const r = l.reason ?? "unknown";
      byReason.set(r, (byReason.get(r) ?? 0) + 1);
    }
  }
  const pairs = lines
    .filter((l) => l.differenceBase !== null && l.differenceBase !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.differenceBase!) / Math.max(1, b.expectedBase) -
          Math.abs(a.differenceBase!) / Math.max(1, a.expectedBase) ||
        Math.abs(b.differenceBase!) - Math.abs(a.differenceBase!),
    )
    .slice(0, pairCount)
    .map((l) => ({
      name: l.productName,
      unit: l.unit,
      expectedBase: l.expectedBase,
      countedBase: l.countedBase ?? 0,
    }));
  const reasons = SHORT_REASONS.filter((r) => (byReason.get(r) ?? 0) > 0).map(
    (r) => ({
      reason: r,
      label: STOCKTAKE_REASON_LABEL[r],
      products: byReason.get(r)!,
    }),
  );
  return { status, pairs, reasons };
}
