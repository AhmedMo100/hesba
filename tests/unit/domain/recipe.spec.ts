import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allowedRecipeUnits,
  calculateMarginPercent,
  calculateProfitPiasters,
  calculateRecipeCost,
  costBasisForUnit,
  ingredientCostMilli,
  ingredientCostPiasters,
  maxUnitsFromStock,
  milliToPiasters,
  perPieceCostFromPack,
  scaleRecipe,
  toRecipeBaseQuantity,
} from "@/domain/recipe";

describe("recipe cost — ingredient conversions", () => {
  it("bread bag 30 ج for 10 pieces costs 3 ج a piece", () => {
    expect(perPieceCostFromPack(3000, 10)).toBe(300);
    // and one piece in a recipe (bread is registered per piece) costs 3 ج, not 30 ج
    expect(ingredientCostPiasters(1, 300, costBasisForUnit("piece"))).toBe(300);
  });

  it("rounds a non-even pack split half up", () => {
    expect(perPieceCostFromPack(1000, 3)).toBe(333); // 333.33
    expect(perPieceCostFromPack(500, 3)).toBe(167); // 166.67
  });

  it("luncheon 200 ج/kg × 5 g = 1.00 ج", () => {
    expect(ingredientCostPiasters(5, 20000, "per_kg")).toBe(100);
  });

  it("cheese 160 ج/kg × 5 g = 0.80 ج", () => {
    expect(ingredientCostPiasters(5, 16000, "per_kg")).toBe(80);
  });

  it("a per-gram product multiplies directly", () => {
    expect(ingredientCostPiasters(20, 25, "per_gram")).toBe(500);
  });

  it("keeps sub-piaster precision until the final rounding", () => {
    // 175 ج/kg × 5 g = 0.875 ج → 87.5 piasters exactly in milli
    expect(ingredientCostMilli(5, 17500, "per_kg")).toBe(BigInt(87500));
    expect(milliToPiasters(BigInt(87500))).toBe(88);
    expect(milliToPiasters(BigInt(87499))).toBe(87);
  });

  it("maps units to cost bases and allowed recipe units", () => {
    expect(costBasisForUnit("kg")).toBe("per_kg");
    expect(costBasisForUnit("g")).toBe("per_gram");
    expect(costBasisForUnit("piece")).toBe("per_unit");
    expect(costBasisForUnit("علبة")).toBe("per_unit");
    expect(allowedRecipeUnits("kg")).toEqual(["g", "kg"]);
    expect(allowedRecipeUnits("piece")).toEqual(["piece"]);
  });

  it("rejects negative or non-integer inputs", () => {
    expect(() => ingredientCostMilli(-1, 100, "per_unit")).toThrow();
    expect(() => ingredientCostMilli(1.5, 100, "per_unit")).toThrow();
    expect(() => ingredientCostMilli(1, 10.5, "per_unit")).toThrow();
    expect(() => perPieceCostFromPack(3000, 0)).toThrow();
  });
});

describe("recipe cost — total, profit, margin", () => {
  const sandwichA = [
    { quantityBase: 1, buyPricePiasters: 300, unit: "piece" }, // bread
    { quantityBase: 5, buyPricePiasters: 20000, unit: "kg" }, // luncheon
    { quantityBase: 5, buyPricePiasters: 16000, unit: "kg" }, // cheese
    { quantityBase: 5, buyPricePiasters: 18000, unit: "kg" }, // roumy
  ];

  it("sums the example recipe to 5.70 ج", () => {
    const cost = calculateRecipeCost(sandwichA);
    expect(cost.lines.map((l) => l.costPiasters)).toEqual([300, 100, 80, 90]);
    expect(cost.totalPiasters).toBe(570);
    expect(cost.missingCostCount).toBe(0);
  });

  it("profit and margin from selling price minus cost", () => {
    expect(calculateProfitPiasters(1000, 570)).toBe(430);
    expect(calculateMarginPercent(1000, 570)).toBe(43);
    expect(calculateMarginPercent(1500, 480)).toBe(68);
    expect(calculateProfitPiasters(500, 570)).toBe(-70);
    expect(calculateMarginPercent(0, 570)).toBeNull();
  });

  it("handles different quantities per ingredient (double sandwich)", () => {
    const cost = calculateRecipeCost([
      { quantityBase: 2, buyPricePiasters: 300, unit: "piece" },
      { quantityBase: 10, buyPricePiasters: 20000, unit: "kg" },
      { quantityBase: 10, buyPricePiasters: 16000, unit: "kg" },
    ]);
    expect(cost.totalPiasters).toBe(600 + 200 + 160);
  });

  it("several independent recipes do not affect each other", () => {
    const luncheon = calculateRecipeCost([
      { quantityBase: 1, buyPricePiasters: 300, unit: "piece" },
      { quantityBase: 5, buyPricePiasters: 20000, unit: "kg" },
    ]);
    const halawa = calculateRecipeCost([
      { quantityBase: 1, buyPricePiasters: 300, unit: "piece" },
      { quantityBase: 20, buyPricePiasters: 9000, unit: "kg" },
    ]);
    expect(luncheon.totalPiasters).toBe(400);
    expect(halawa.totalPiasters).toBe(480);
  });

  it("rounds the exact sum once (not the sum of rounded lines)", () => {
    // 3 × 0.5 piaster lines: each displays 1 piaster (half up) but the total is 1.5 → 2
    const cost = calculateRecipeCost([
      { quantityBase: 1, buyPricePiasters: 500, unit: "kg" },
      { quantityBase: 1, buyPricePiasters: 500, unit: "kg" },
      { quantityBase: 1, buyPricePiasters: 500, unit: "kg" },
    ]);
    expect(cost.lines.map((l) => l.costPiasters)).toEqual([1, 1, 1]);
    expect(cost.totalPiasters).toBe(2);
  });

  it("flags ingredients without a registered purchase price", () => {
    const cost = calculateRecipeCost([
      { quantityBase: 1, buyPricePiasters: 0, unit: "piece" },
      { quantityBase: 5, buyPricePiasters: 20000, unit: "kg" },
    ]);
    expect(cost.missingCostCount).toBe(1);
    expect(cost.lines[0]?.missingCost).toBe(true);
    expect(cost.totalPiasters).toBe(100);
  });

  it("is always an integer and never negative (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            quantityBase: fc.integer({ min: 1, max: 100_000 }),
            buyPricePiasters: fc.integer({ min: 0, max: 10_000_000 }),
            unit: fc.constantFrom("kg", "g", "piece", "علبة"),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (lines) => {
          const cost = calculateRecipeCost(lines);
          expect(Number.isSafeInteger(cost.totalPiasters)).toBe(true);
          expect(cost.totalPiasters).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe("recipe stock — scaling and availability", () => {
  const lines = [
    { variantId: "bread", quantityBase: 1 },
    { variantId: "luncheon", quantityBase: 5 },
    { variantId: "cheese", quantityBase: 5 },
  ];

  it("selling 3 sandwiches needs 3 bread, 15 g luncheon, 15 g cheese", () => {
    const needs = scaleRecipe(lines, 3);
    expect(needs.get("bread")).toBe(BigInt(3));
    expect(needs.get("luncheon")).toBe(BigInt(15));
    expect(needs.get("cheese")).toBe(BigInt(15));
  });

  it("rejects a non-positive count", () => {
    expect(() => scaleRecipe(lines, 0)).toThrow();
    expect(() => scaleRecipe(lines, 1.5)).toThrow();
  });

  it("counts how many sandwiches the stock can make", () => {
    const stock = new Map([
      ["bread", 2],
      ["luncheon", 100],
      ["cheese", 100],
    ]);
    expect(maxUnitsFromStock(lines, stock)).toBe(2);
    expect(maxUnitsFromStock(lines, new Map([["bread", 10]]))).toBe(0);
    expect(maxUnitsFromStock([], stock)).toBe(0);
  });
});

describe("recipe amounts — base unit precision", () => {
  it("converts kilos to whole grams", () => {
    expect(toRecipeBaseQuantity(0.005, "kg")).toEqual({
      ok: true,
      quantityBase: 5,
    });
    expect(toRecipeBaseQuantity(0.25, "kg")).toEqual({
      ok: true,
      quantityBase: 250,
    });
  });

  it("rejects half grams and fractional pieces instead of rounding", () => {
    expect(toRecipeBaseQuantity(0.5, "g")).toEqual({
      ok: false,
      reason: "fractional_base",
    });
    expect(toRecipeBaseQuantity(0.0055, "kg")).toEqual({
      ok: false,
      reason: "fractional_base",
    });
    expect(toRecipeBaseQuantity(1.5, "piece")).toEqual({
      ok: false,
      reason: "fractional_base",
    });
  });

  it("rejects zero, negative and absurd amounts", () => {
    expect(toRecipeBaseQuantity(0, "g").ok).toBe(false);
    expect(toRecipeBaseQuantity(-1, "piece").ok).toBe(false);
    expect(toRecipeBaseQuantity(2000, "kg").ok).toBe(false);
  });
});
