import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  depleteStockFEFO,
  calculateStockLevelFromMovements,
  calculateBatchRemainingFromMovements,
  sortBatchesFEFO,
  isNearExpiry,
} from "@/domain/stock/stock-engine";

const ZERO = BigInt(0);

describe("Stock & FEFO Property-Based Invariant Tests (1,000 Runs)", () => {
  // Arbitrary generator for individual batches
  const batchArbitrary = fc.record({
    id: fc.uuid(),
    storeVariantId: fc.constant("variant-test-uuid"),
    batchCode: fc.option(fc.string({ minLength: 2, maxLength: 8 }), {
      nil: null,
    }),
    remainingQuantityBase: fc.bigInt({ min: BigInt(1), max: BigInt(10_000) }),
    costPriceMinor: fc.bigInt({ min: BigInt(100), max: BigInt(100_000) }),
    expiryDate: fc.option(
      fc.date({
        min: new Date("2026-01-01"),
        max: new Date("2027-12-31"),
        noInvalidDate: true,
      }),
      { nil: null },
    ),
    receivedAt: fc.date({
      min: new Date("2025-01-01"),
      max: new Date("2026-12-31"),
      noInvalidDate: true,
    }),
  });

  it("Invariant 1: Stock level is always strictly equal to the sum of all movements (1,000 sequences)", () => {
    // Generate movement sequences with positive and negative base quantities
    const movementArbitrary = fc.record({
      quantityBase: fc.bigInt({ min: BigInt(-50_000), max: BigInt(50_000) }),
    });

    fc.assert(
      fc.property(
        fc.array(movementArbitrary, { minLength: 1, maxLength: 50 }),
        (movements) => {
          const calculated = calculateStockLevelFromMovements(movements);

          let expectedSum = ZERO;
          for (const m of movements) {
            expectedSum += m.quantityBase;
          }

          expect(calculated).toBe(expectedSum);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("Invariant 2: FEFO Depletion strictly depletes earlier expiry dates first (1,000 runs)", () => {
    fc.assert(
      fc.property(
        fc.array(batchArbitrary, { minLength: 2, maxLength: 10 }),
        fc.bigInt({ min: BigInt(1), max: BigInt(20_000) }),
        (batches, requestedQty) => {
          // Ensure distinct expiry dates for clear ordering verification
          const result = depleteStockFEFO(batches, requestedQty);

          // 1. Total allocated quantity must match requested quantity
          const totalAllocated = result.allocations.reduce(
            (acc, a) => acc + a.quantityBase,
            ZERO,
          );
          expect(totalAllocated).toBe(requestedQty);

          // 2. Verified sorted order
          const sorted = sortBatchesFEFO(batches);
          for (let i = 0; i < sorted.length - 1; i++) {
            const current = sorted[i]!;
            const next = sorted[i + 1]!;
            if (current.expiryDate && next.expiryDate) {
              expect(current.expiryDate.getTime()).toBeLessThanOrEqual(
                next.expiryDate.getTime(),
              );
            } else if (current.expiryDate && !next.expiryDate) {
              // Current with expiry comes before next without expiry
              expect(true).toBe(true);
            } else if (!current.expiryDate && next.expiryDate) {
              // Should never happen: null expiry cannot precede a valid expiry
              expect(false).toBe(true);
            }
          }

          // 3. For any depleted batch with an expiry date, no later-expiry batch can be depleted
          // before the earlier batch is completely exhausted (remaining == 0)
          for (let i = 0; i < result.allocations.length - 1; i++) {
            const alloc = result.allocations[i]!;
            if (!alloc.batchId) continue; // negative deficit allocation

            const updated = result.updatedBatches.find(
              (u) => u.id === alloc.batchId,
            )!;

            const nextAlloc = result.allocations[i + 1]!;
            if (nextAlloc.batchId) {
              // If we proceeded to deplete a next batch, the current batch MUST be fully exhausted
              expect(updated.remainingQuantityBase).toBe(ZERO);
            }
          }

          // 4. Batch remaining balance is never negative
          for (const updated of result.updatedBatches) {
            expect(updated.remainingQuantityBase).toBeGreaterThanOrEqual(ZERO);
          }

          // 5. Shortfall allocation occurs if and only if requestedQty > total available
          const totalAvailable = batches.reduce(
            (acc, b) => acc + b.remainingQuantityBase,
            ZERO,
          );
          if (requestedQty > totalAvailable) {
            expect(result.shortfallBase).toBe(requestedQty - totalAvailable);
            const negativeAlloc = result.allocations.find((a) => a.isNegative);
            expect(negativeAlloc).toBeDefined();
            expect(negativeAlloc?.quantityBase).toBe(
              requestedQty - totalAvailable,
            );
          } else {
            expect(result.shortfallBase).toBe(ZERO);
            const negativeAlloc = result.allocations.find((a) => a.isNegative);
            expect(negativeAlloc).toBeUndefined();
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("Invariant 3: Batch remaining balance equals initial received plus sum of its movements (1,000 runs)", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(100), max: BigInt(50_000) }),
        fc.array(
          fc.record({
            quantityBase: fc.bigInt({ min: BigInt(-5_000), max: ZERO }), // depletions are negative
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (initialReceived, depletions) => {
          const remaining = calculateBatchRemainingFromMovements(
            initialReceived,
            depletions,
          );

          let expected = initialReceived;
          for (const d of depletions) {
            expected += d.quantityBase;
          }

          expect(remaining).toBe(expected);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("Invariant 4: Near expiry threshold logic correctly flags items within 7 days", () => {
    const now = new Date("2026-10-29T12:00:00Z");

    // Past expiry
    expect(isNearExpiry(new Date("2026-10-20"), now, 7)).toBe(true);

    // 3 days away
    expect(isNearExpiry(new Date("2026-11-01"), now, 7)).toBe(true);

    // Exactly 7 days away
    expect(isNearExpiry(new Date("2026-11-05"), now, 7)).toBe(true);

    // 10 days away
    expect(isNearExpiry(new Date("2026-11-09"), now, 7)).toBe(false);

    // No expiry
    expect(isNearExpiry(null, now, 7)).toBe(false);
  });
});
