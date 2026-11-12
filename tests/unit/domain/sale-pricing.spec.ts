import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allocateByWeight,
  isServiceProduct,
  saleLineTotalPiasters,
} from "@/domain/sale-pricing";

describe("sale pricing (ADR-0019)", () => {
  it("prices pieces, cartons and grams from the registered selling price", () => {
    expect(saleLineTotalPiasters("piece", 1250, 3)).toBe(3750);
    expect(saleLineTotalPiasters("carton", 30000, 2)).toBe(60000);
    expect(saleLineTotalPiasters("g", 15, 40)).toBe(600); // price per gram
    expect(saleLineTotalPiasters("kg", 20000, 250)).toBe(5000); // 250 g of 200 ج/kg
  });

  it("rounds a weighed total once, half up", () => {
    expect(saleLineTotalPiasters("kg", 9999, 3)).toBe(30); // 29.997
    expect(saleLineTotalPiasters("kg", 1000, 1)).toBe(1); // 1.0
    expect(saleLineTotalPiasters("kg", 500, 1)).toBe(1); // 0.5 → 1
    expect(saleLineTotalPiasters("kg", 499, 1)).toBe(0); // 0.499 → 0
  });

  it("rejects non-integer or negative inputs", () => {
    expect(() => saleLineTotalPiasters("piece", 10.5, 1)).toThrow();
    expect(() => saleLineTotalPiasters("piece", 100, -1)).toThrow();
  });

  it("classifies services by category or unit", () => {
    expect(isServiceProduct({ category: "شحن رصيد", unit: "piece" })).toBe(
      true,
    );
    expect(isServiceProduct({ category: "خدمات وفواتير" })).toBe(true);
    expect(isServiceProduct({ category: "مشروبات", unit: "service" })).toBe(
      true,
    );
    expect(isServiceProduct({ category: "مشروبات", unit: "piece" })).toBe(
      false,
    );
    expect(isServiceProduct({ category: null, unit: "kg" })).toBe(false);
  });

  describe("allocateByWeight", () => {
    it("splits by weight and adds up exactly", () => {
      expect(allocateByWeight(1500, [1000, 1000])).toEqual([750, 750]);
      expect(allocateByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
      expect(allocateByWeight(10, [0, 5])).toEqual([0, 10]);
      expect(allocateByWeight(7, [0, 0])).toEqual([4, 3]); // equal split when all zero
      expect(allocateByWeight(0, [3, 4])).toEqual([0, 0]);
      expect(allocateByWeight(5, [])).toEqual([]);
    });

    it("always sums to the total, never negative (property)", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 10_000_000 }),
          fc.array(fc.integer({ min: 0, max: 1_000_000 }), {
            minLength: 1,
            maxLength: 12,
          }),
          (total, weights) => {
            const parts = allocateByWeight(total, weights);
            expect(parts).toHaveLength(weights.length);
            expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
            expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(
              true,
            );
          },
        ),
      );
    });

    it("rejects invalid totals and weights", () => {
      expect(() => allocateByWeight(-1, [1])).toThrow();
      expect(() => allocateByWeight(1.5, [1])).toThrow();
      expect(() => allocateByWeight(10, [-1, 2])).toThrow();
    });
  });
});
