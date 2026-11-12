import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseHomeReport } from "@/client/shared/api/reports";

/**
 * QA-07 guard (ADR-0021): Home must not invent cost or profit. Its financial figures come
 * from the server report; this pins that the old placeholders (cost = 75% of revenue,
 * profit = 25%) and client-side money arithmetic do not come back.
 */
const source = readFileSync(
  path.resolve(
    import.meta.dirname,
    "../../../src/client/features/home/HomeView.tsx",
  ),
  "utf8",
);

describe("Home report — no fabricated money", () => {
  it("has no percentage-of-revenue cost or profit", () => {
    expect(source).not.toMatch(/\*\s*0\.(75|25)\b/);
    expect(source).not.toMatch(/0\.(75|25)\s*\*/);
  });

  it("does not read the sales or expenses lists to compute money itself", () => {
    expect(source).not.toMatch(/fetch\("\/api\/sales"/);
    expect(source).not.toMatch(/fetch\("\/api\/expenses/);
    expect(source).toMatch(/fetchHomeReport\(/);
  });

  it("the client contract rejects a report with renamed or missing money fields", () => {
    const valid = {
      period: "today",
      from: "2026-11-10T22:00:00.000Z",
      to: "2026-11-11T22:00:00.000Z",
      sales: {
        count: 2,
        revenuePiasters: 3000,
        cogsPiasters: null,
        grossProfitPiasters: null,
        unknownCostCount: 1,
        knownCostRevenuePiasters: 1500,
        knownCostPiasters: 1100,
      },
      expenses: { count: 1, totalPiasters: 12345 },
      purchases: { totalPiasters: 38000, count: 3, unknownCostCount: 0 },
      losses: {
        count: 0,
        costPiasters: 0,
        unknownCostCount: 0,
        byReason: [],
        recent: [],
      },
      series: { granularity: "hour", points: [] },
      topProducts: [],
      byCategory: [],
      activity: [],
    };
    expect(parseHomeReport(valid).sales.cogsPiasters).toBeNull();
    // The QA-06 bug: a renamed field (amountPiasters vs totalPiasters) must fail loudly.
    expect(() =>
      parseHomeReport({
        ...valid,
        expenses: { count: 1, amount_piasters: 12345 },
      }),
    ).toThrow();
    // A fractional amount is not money in piasters.
    expect(() =>
      parseHomeReport({
        ...valid,
        sales: { ...valid.sales, revenuePiasters: 30.5 },
      }),
    ).toThrow();
  });
});
