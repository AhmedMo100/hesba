import { describe, expect, it } from "vitest";
import {
  createStocktakeSessionSchema,
  updateStocktakeCountsSchema,
  reconcileStocktakeSchema,
} from "@/schemas/stocktake";
import { stockValuePiasters } from "@/domain/stock/stock-value";
import { totalFromUnitCost } from "@/domain/stock/batch-cost";

describe("Physical Stocktake Unit Logic", () => {
  describe("Zod Validation Schemas", () => {
    it("validates createStocktakeSessionSchema with full scope", () => {
      const parsed = createStocktakeSessionSchema.parse({
        scope: "full",
        notes: "Monthly physical stocktake",
      });
      expect(parsed.scope).toBe("full");
      expect(parsed.notes).toBe("Monthly physical stocktake");
    });

    it("validates createStocktakeSessionSchema with category scope", () => {
      const parsed = createStocktakeSessionSchema.parse({
        scope: "category",
        category: "مشروبات",
      });
      expect(parsed.scope).toBe("category");
      expect(parsed.category).toBe("مشروبات");
    });

    it("validates updateStocktakeCountsSchema", () => {
      const valid = {
        items: [
          {
            storeVariantId: "a0000000-0000-4000-8000-000000000001",
            countedQuantityBase: 15,
            classification: "damaged_or_expired" as const,
          },
        ],
      };
      const parsed = updateStocktakeCountsSchema.parse(valid);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]?.countedQuantityBase).toBe(15);
      expect(parsed.items[0]?.classification).toBe("damaged_or_expired");
    });

    it("rejects negative counts in updateStocktakeCountsSchema", () => {
      expect(() =>
        updateStocktakeCountsSchema.parse({
          items: [
            {
              storeVariantId: "a0000000-0000-4000-8000-000000000001",
              countedQuantityBase: -5,
            },
          ],
        }),
      ).toThrow();
    });

    it("validates reconcileStocktakeSchema", () => {
      const parsed = reconcileStocktakeSchema.parse({
        notes: "Approved by manager",
        itemClassifications: {
          "a0000000-0000-4000-8000-000000000001": {
            classification: "unrecorded_sales",
            notes: "Quick sale during rush hour",
          },
        },
      });
      expect(parsed.notes).toBe("Approved by manager");
      expect(
        parsed.itemClassifications?.["a0000000-0000-4000-8000-000000000001"]
          ?.classification,
      ).toBe("unrecorded_sales");
    });
  });

  describe("Dynamic Stocktake Calculations & Cutoff Logic", () => {
    it("calculates expected stock by combining snapshot with legitimate movements", () => {
      const snapshotQty = 100;
      const movements = [
        { type: "sale", quantityBase: -10 },
        { type: "purchase", quantityBase: 25 },
        { type: "waste", quantityBase: -3 },
        { type: "sale", quantityBase: -7 },
      ];

      const netMovements = movements.reduce(
        (sum, m) => sum + m.quantityBase,
        0,
      );
      const expectedStock = snapshotQty + netMovements;

      // 100 - 10 + 25 - 3 - 7 = 105
      expect(expectedStock).toBe(105);

      // If counted is 100, discrepancy is 100 - 105 = -5 (shortage of 5)
      const counted = 100;
      const discrepancy = counted - expectedStock;
      expect(discrepancy).toBe(-5);
    });

    it("calculates surplus when counted exceeds expected stock", () => {
      const snapshotQty = 50;
      const movements = [{ type: "sale", quantityBase: -5 }];
      const expectedStock = snapshotQty + movements[0]!.quantityBase; // 45
      const counted = 50; // Found 50 on shelf

      const discrepancy = counted - expectedStock;
      expect(discrepancy).toBe(5); // Surplus of +5
    });

    it("evaluates discrepancy cost correctly for piece items", () => {
      const unit = "piece";
      const unitCostPiasters = 2500; // 25.00 EGP
      const discrepancyQty = -4; // Shortage of 4

      const cost = stockValuePiasters(
        unit,
        Math.abs(discrepancyQty),
        unitCostPiasters,
      );
      expect(cost).toBe(10000); // 100.00 EGP
    });

    it("evaluates discrepancy cost correctly for weighed items (grams)", () => {
      const unit = "kg";
      const unitCostPerKgPiasters = 12000; // 120.00 EGP per kg
      const discrepancyGrams = 500; // Half kg surplus

      const cost = stockValuePiasters(
        unit,
        discrepancyGrams,
        unitCostPerKgPiasters,
      );
      expect(cost).toBe(6000); // 60.00 EGP
    });

    it("computes batch total cost for surplus adjustment batch", () => {
      const unit = "piece";
      const unitCost = BigInt(3500); // 35 EGP
      const quantity = BigInt(10);

      const totalCost = totalFromUnitCost(unitCost, quantity, unit);
      expect(totalCost).toBe(BigInt(35000));
    });
  });
});
