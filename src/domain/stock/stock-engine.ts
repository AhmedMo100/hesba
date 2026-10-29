/**
 * Pure Domain Engine for Stock Batches, Append-Only Movements, and FEFO Depletion.
 *
 * Rules:
 * 1. Money is integer piasters (minor).
 * 2. Quantities are integer base units (grams for weighed, pieces for discreet).
 * 3. FEFO: First-Expired First-Out. Batches sorted by expiry_date ASC (nulls last), then received_at ASC.
 * 4. Invariant: Current stock level === SUM(all stock movements).
 * 5. Invariant: Batch remaining === received_quantity + SUM(movements for this batch).
 * 6. Depletion shortfall produces an unbatched negative movement (negative=true).
 */

export interface StockBatchCandidate {
  id: string;
  storeVariantId: string;
  batchCode?: string | null;
  remainingQuantityBase: bigint;
  costPriceMinor: bigint;
  expiryDate?: Date | null;
  receivedAt: Date;
}

export interface DepletionAllocation {
  batchId: string | null;
  quantityBase: bigint; // positive amount depleted
  costPriceMinor: bigint;
  isNegative: boolean;
}

export interface FEFODepletionResult {
  allocations: DepletionAllocation[];
  updatedBatches: Array<{ id: string; remainingQuantityBase: bigint }>;
  totalDepletedBase: bigint;
  shortfallBase: bigint;
}

function isValidDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Sorts batches according to strict FEFO:
 * 1. Earliest valid expiry date first.
 * 2. Batches with no or invalid expiry date come LAST.
 * 3. Tie-breaker: oldest receipt date (received_at ASC).
 */
export function sortBatchesFEFO(
  batches: readonly StockBatchCandidate[],
): StockBatchCandidate[] {
  return [...batches].sort((a, b) => {
    const aValid = isValidDate(a.expiryDate);
    const bValid = isValidDate(b.expiryDate);

    if (aValid && bValid) {
      const diff = a.expiryDate!.getTime() - b.expiryDate!.getTime();
      if (diff !== 0) return diff;
    } else if (aValid && !bValid) {
      return -1; // a expires first, b has no expiry
    } else if (!aValid && bValid) {
      return 1; // b expires first, a has no expiry
    }
    const aRec = isValidDate(a.receivedAt) ? a.receivedAt.getTime() : 0;
    const bRec = isValidDate(b.receivedAt) ? b.receivedAt.getTime() : 0;
    return aRec - bRec;
  });
}

/**
 * Pure FEFO depletion across available stock batches.
 */
export function depleteStockFEFO(
  availableBatches: readonly StockBatchCandidate[],
  requestedQuantityBase: bigint,
): FEFODepletionResult {
  const ZERO = BigInt(0);
  if (requestedQuantityBase <= ZERO) {
    return {
      allocations: [],
      updatedBatches: [],
      totalDepletedBase: ZERO,
      shortfallBase: ZERO,
    };
  }

  const sorted = sortBatchesFEFO(
    availableBatches.filter((b) => b.remainingQuantityBase > ZERO),
  );

  let needed = requestedQuantityBase;
  const allocations: DepletionAllocation[] = [];
  const updatedBatches: Array<{ id: string; remainingQuantityBase: bigint }> =
    [];

  for (const batch of sorted) {
    if (needed === ZERO) break;

    if (batch.remainingQuantityBase >= needed) {
      allocations.push({
        batchId: batch.id,
        quantityBase: needed,
        costPriceMinor: batch.costPriceMinor,
        isNegative: false,
      });
      updatedBatches.push({
        id: batch.id,
        remainingQuantityBase: batch.remainingQuantityBase - needed,
      });
      needed = ZERO;
    } else {
      // Deplete entire batch remaining
      const take = batch.remainingQuantityBase;
      allocations.push({
        batchId: batch.id,
        quantityBase: take,
        costPriceMinor: batch.costPriceMinor,
        isNegative: false,
      });
      updatedBatches.push({
        id: batch.id,
        remainingQuantityBase: ZERO,
      });
      needed -= take;
    }
  }

  // If deficit remains, allocate negative outflow
  if (needed > ZERO) {
    allocations.push({
      batchId: null,
      quantityBase: needed,
      costPriceMinor: ZERO,
      isNegative: true,
    });
  }

  return {
    allocations,
    updatedBatches,
    totalDepletedBase: requestedQuantityBase,
    shortfallBase: needed,
  };
}

/**
 * Recomputes the stock level balance by summing chronological movements.
 */
export function calculateStockLevelFromMovements(
  movements: ReadonlyArray<{ quantityBase: bigint }>,
): bigint {
  return movements.reduce((acc, m) => acc + m.quantityBase, BigInt(0));
}

/**
 * Recomputes a batch's remaining balance from its movements.
 */
export function calculateBatchRemainingFromMovements(
  receivedQuantityBase: bigint,
  batchMovements: ReadonlyArray<{ quantityBase: bigint }>,
): bigint {
  return batchMovements.reduce(
    (acc, m) => acc + m.quantityBase,
    receivedQuantityBase,
  );
}

/**
 * Checks whether a batch is near expiry (within threshold days, default 7 days).
 */
export function isNearExpiry(
  expiryDate: Date | null | undefined,
  now = new Date(),
  thresholdDays = 7,
): boolean {
  if (!isValidDate(expiryDate)) return false;
  const expiryTime = expiryDate.getTime();
  const nowTime = isValidDate(now) ? now.getTime() : Date.now();
  if (expiryTime < nowTime) return true; // already expired
  const diffDays = (expiryTime - nowTime) / (1000 * 60 * 60 * 24);
  return diffDays <= thresholdDays;
}
