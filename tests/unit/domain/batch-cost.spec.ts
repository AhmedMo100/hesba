import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  baseUnitsPerSellingUnit,
  milliToWholePiasters,
  sumTakeCosts,
  takeCostMilli,
  totalFromUnitCost,
  unitCostFromTotal,
} from "@/domain/stock/batch-cost";
import {
  addDaysToDateKey,
  cairoDayStartUtc,
  cairoHour,
  toCairoDateString,
} from "@/domain/time";

const n = (v: bigint | null) => (v === null ? null : Number(v));

describe("batch cost model (ADR-0021, QA-08)", () => {
  it("derives the unit cost per SELLING unit from the total (the audit example)", () => {
    expect(n(unitCostFromTotal(16000, 20, "piece"))).toBe(800); // 20 cola for 160.00
    expect(n(unitCostFromTotal(6000, 20, "piece"))).toBe(300); // 20 bread for 60.00
    expect(n(unitCostFromTotal(16000, 1000, "kg"))).toBe(16000); // 1000 g for 160.00 → per kg
    expect(n(unitCostFromTotal(16000, 1000, "g"))).toBe(16); // per gram for `g` products
    expect(n(unitCostFromTotal(30000, 2, "carton"))).toBe(15000);
  });

  it("rounds a unit cost half up and keeps unknown as unknown", () => {
    expect(n(unitCostFromTotal(1000, 3, "piece"))).toBe(333); // 333.33
    expect(n(unitCostFromTotal(500, 3, "piece"))).toBe(167); // 166.67
    expect(n(unitCostFromTotal(15550, 1000, "kg"))).toBe(15550);
    expect(unitCostFromTotal(null, 10, "piece")).toBeNull();
    expect(unitCostFromTotal(1000, 0, "piece")).toBeNull();
    expect(() => unitCostFromTotal(-1, 3, "piece")).toThrow();
  });

  it("derives a total from a registered unit price (initial stock, adjustment)", () => {
    expect(n(totalFromUnitCost(20000, 500, "kg"))).toBe(10000); // 500 g at 200/kg
    expect(n(totalFromUnitCost(800, 20, "piece"))).toBe(16000);
    expect(n(totalFromUnitCost(9999, 3, "kg"))).toBe(30); // 29.997
    expect(totalFromUnitCost(null, 3, "piece")).toBeNull();
    expect(baseUnitsPerSellingUnit("kg")).toBe(1000);
    expect(baseUnitsPerSellingUnit("piece")).toBe(1);
  });

  it("costs a part of a batch proportionally to its total, rounded once", () => {
    // 3 pieces for 10.00: selling all 3 costs exactly 10.00 (not 3 × 3.33 = 9.99)
    const parts = [BigInt(1), BigInt(1), BigInt(1)].map((q) =>
      takeCostMilli(BigInt(1000), BigInt(3), q),
    );
    expect(n(sumTakeCosts(parts))).toBe(1000);
    // 250 g out of 1000 g that cost 160.00 → 40.00
    expect(
      n(
        sumTakeCosts([takeCostMilli(BigInt(16000), BigInt(1000), BigInt(250))]),
      ),
    ).toBe(4000);
    // a line drawing from two batches with different costs
    expect(
      n(
        sumTakeCosts([
          takeCostMilli(BigInt(1000), BigInt(10), BigInt(4)), // 4 × 1.00
          takeCostMilli(BigInt(3000), BigInt(10), BigInt(2)), // 2 × 3.00
        ]),
      ),
    ).toBe(1000);
  });

  it("an unknown part makes the whole cost unknown (never a partial or estimated cost)", () => {
    expect(takeCostMilli(null, BigInt(10), BigInt(2))).toBeNull();
    expect(
      sumTakeCosts([takeCostMilli(BigInt(1000), BigInt(10), BigInt(2)), null]),
    ).toBeNull();
    expect(n(sumTakeCosts([]))).toBe(0);
    expect(() => milliToWholePiasters(-BigInt(1))).toThrow();
  });

  it("splitting a batch into any takes never loses or invents more than one rounding (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 500 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (total, takes) => {
          const received = BigInt(takes.reduce((a, b) => a + b, 0));
          const cost = sumTakeCosts(
            takes.map((q) => takeCostMilli(BigInt(total), received, BigInt(q))),
          )!;
          expect(Math.abs(Number(cost) - total)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe("Cairo calendar helpers (report periods)", () => {
  it("finds the UTC start of a Cairo day, in winter (UTC+2) and in summer (UTC+3)", () => {
    expect(cairoDayStartUtc("2026-01-15").toISOString()).toBe(
      "2026-01-14T22:00:00.000Z",
    );
    expect(cairoDayStartUtc("2026-07-15").toISOString()).toBe(
      "2026-07-14T21:00:00.000Z",
    );
    expect(toCairoDateString(cairoDayStartUtc("2026-07-15"))).toBe(
      "2026-07-15",
    );
  });

  it("reads the Cairo hour and adds calendar days", () => {
    expect(cairoHour("2026-01-14T22:30:00Z")).toBe(0);
    expect(cairoHour("2026-01-15T10:00:00Z")).toBe(12);
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});
