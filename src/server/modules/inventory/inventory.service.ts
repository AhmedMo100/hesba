import { stockLevel } from "@/domain/alerts";
import "server-only";
import { Prisma, PrismaClient } from "@prisma/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  depleteStockFEFO,
  isNearExpiry,
  type StockBatchCandidate,
} from "@/domain/stock/stock-engine";
import {
  milliToWholePiasters,
  sumTakeCosts,
  takeCostMilli,
  totalFromUnitCost,
  unitCostFromTotal,
} from "@/domain/stock/batch-cost";

/**
 * @file inventory.service.ts
 * @description Store inventory: stock batches, the append-only stock movement ledger, and the
 * per-variant `stock_levels` cache.
 *
 * @responsibility
 * Add stock (a batch + `purchase` movement), record waste, void a batch, adjust (set/delta),
 * clear, archive, deplete for a sale (FEFO), and read inventory and movement history.
 *
 * @dependencies
 * `withTenant` (every method runs in one tenant transaction), `domain/stock/stock-engine`
 * (pure FEFO allocation and near-expiry rule).
 *
 * @usedBy
 * `src/app/api/stock/route.ts`, `src/server/modules/alerts` (`getStoreInventory`).
 *
 * @remarks
 * - Quantities are integer base units (pieces or grams) held as `bigint`; costs are integer
 *   piasters.
 * - Movements are never updated or deleted: every change appends a movement whose
 *   `balanceAfterBase` records the running balance. `stock_levels` and each batch's
 *   `remainingQuantityBase` are caches derived from those movements.
 * - Methods that accept an `opId` return `{ duplicate: true }` when a movement with that
 *   `opId` already exists for the store. The check runs after the stock lock, so a
 *   concurrent retry waits for the first attempt and then sees it.
 * - Concurrency (ADR-0019): every method that changes a variant's stock first locks that
 *   variant's `stock_levels` row (`lockStockLevelInTx`, `SELECT … FOR UPDATE`) and computes
 *   the new balance from the locked value. Operations on the same variant therefore run one
 *   after the other, and the level, the batches and each movement's `balanceAfterBase` stay
 *   consistent. Operations on different variants do not wait for each other.
 * - Sales deplete stock through `depleteVariantFefoInTx` inside the sale transaction
 *   (`modules/sales`); the sales screen no longer deducts stock with a separate request.
 */

const ZERO = BigInt(0);

/**
 * Locks the `stock_levels` rows of the given variants for the rest of the caller's tenant
 * transaction and returns their balances (ADR-0019, ADR-0021).
 *
 * Every write to a variant's stock — its level, its batches and its movements — goes through
 * this lock first, so concurrent operations on the same variant run one after the other:
 * each one reads the balance left by the previous commit instead of overwriting it (no lost
 * updates). Under READ COMMITTED, statements after the lock see everything committed before
 * it, which is why callers check their `opId` after locking.
 *
 * The balance returned is the LEDGER's (Σ `stock_movements.quantity_base`), read under the
 * lock — the ledger is the source of truth (QA-05). Every writer then stores the new ledger
 * balance into `stock_levels`, so a stale cache is corrected by the next write instead of
 * being carried forward.
 *
 * A variant without a level row gets one at 0 first, because only an existing row can be
 * locked. Rows are locked in id order, so multi-variant callers (sandwiches, promotions)
 * cannot deadlock with each other.
 */
export async function lockStockLevelsInTx(
  tx: TenantTx,
  storeId: string,
  variantIds: readonly string[],
): Promise<Map<string, bigint>> {
  const ids = [...new Set(variantIds)].sort();
  if (ids.length === 0) return new Map();
  await tx.$executeRaw`
    INSERT INTO stock_levels (store_id, store_variant_id, quantity_base, updated_at)
    SELECT ${storeId}::uuid, v.id, 0, now()
      FROM unnest(${ids}::uuid[]) AS v(id)
    ON CONFLICT (store_id, store_variant_id) DO NOTHING`;
  await tx.$queryRaw`SELECT store_variant_id
      FROM stock_levels
     WHERE store_id = ${storeId}::uuid
       AND store_variant_id = ANY(${ids}::uuid[])
     ORDER BY store_variant_id
       FOR UPDATE`;
  const ledger = await tx.$queryRaw<
    Array<{ store_variant_id: string; qty: bigint }>
  >`SELECT store_variant_id::text AS store_variant_id,
           COALESCE(SUM(quantity_base), 0)::bigint AS qty
      FROM stock_movements
     WHERE store_id = ${storeId}::uuid
       AND store_variant_id = ANY(${ids}::uuid[])
     GROUP BY store_variant_id`;
  const balances = new Map<string, bigint>(ids.map((id) => [id, ZERO]));
  for (const r of ledger) balances.set(r.store_variant_id, BigInt(r.qty));
  return balances;
}

/** Locks one variant's level (see {@link lockStockLevelsInTx}) and returns its balance. */
export async function lockStockLevelInTx(
  tx: TenantTx,
  storeId: string,
  variantId: string,
): Promise<bigint> {
  const levels = await lockStockLevelsInTx(tx, storeId, [variantId]);
  return levels.get(variantId) ?? ZERO;
}

/** Writes the `stock_levels` cache: always the ledger balance computed under the lock. */
export async function writeLevelInTx(
  tx: TenantTx,
  storeId: string,
  storeVariantId: string,
  balance: bigint,
  now: Date,
): Promise<void> {
  await tx.stockLevel.upsert({
    where: { storeId_storeVariantId: { storeId, storeVariantId } },
    update: { quantityBase: balance, updatedAt: now },
    create: { storeId, storeVariantId, quantityBase: balance, updatedAt: now },
  });
}

/** One part of a take: which batch, how much, and its cost (proportional to the batch total). */
export interface StockTake {
  batchId: string | null;
  quantityBase: bigint;
  /** The batch's unit cost per selling unit; null when unknown or unbatched. */
  unitCostPiasters: bigint | null;
  /** Exact cost of this part in milli-piasters; null when unknown or unbatched. */
  costMilli: bigint | null;
}

/**
 * Takes `quantityBase` of one variant out of stock inside the caller's tenant transaction
 * (ADR-0021): the batch quantities, the ledger and the cache change together.
 * - Draws FEFO from the variant's batches — or only from `batchId` when given.
 * - Appends one movement of `type` per batch part (linked to the sale line / waste), with
 *   the batch's unit cost and the running ledger balance.
 * - Writes the new ledger balance into `stock_levels`.
 *
 * Locks the variant first (a no-op when the caller already holds the lock). It performs no
 * availability check: callers that must not go below zero check after locking. Quantity not
 * covered by batches (only possible with data that predates the QA-05 repair) becomes an
 * unbatched part flagged `negative`, with unknown cost.
 */
export async function takeStockInTx(
  tx: TenantTx,
  storeId: string,
  input: {
    storeVariantId: string;
    storeProductId: string | null;
    quantityBase: bigint;
    type: "sale" | "waste" | "adjustment";
    batchId?: string | null;
    saleLineId?: string | null;
    wasteId?: string | null;
    opId?: string | null;
    now: Date;
  },
): Promise<{
  takes: StockTake[];
  costPiasters: bigint | null;
  newBalance: bigint;
}> {
  const { now } = input;
  const balance = await lockStockLevelInTx(tx, storeId, input.storeVariantId);
  const batches = await tx.storeStockBatch.findMany({
    where: {
      storeId,
      storeVariantId: input.storeVariantId,
      remainingQuantityBase: { gt: ZERO },
      ...(input.batchId ? { id: input.batchId } : {}),
    },
  });
  const byId = new Map(batches.map((b) => [b.id, b]));

  const candidates: StockBatchCandidate[] = batches.map((b) => ({
    id: b.id,
    storeVariantId: b.storeVariantId,
    batchCode: b.batchCode,
    remainingQuantityBase: b.remainingQuantityBase,
    costPriceMinor: b.costPriceMinor ?? ZERO,
    expiryDate: b.expiryDate,
    receivedAt: b.receivedAt,
  }));
  const depletion = depleteStockFEFO(candidates, input.quantityBase);

  for (const updated of depletion.updatedBatches) {
    await tx.storeStockBatch.update({
      where: { id: updated.id },
      data: {
        remainingQuantityBase: updated.remainingQuantityBase,
        updatedAt: now,
      },
    });
  }

  let running = balance;
  const takes: StockTake[] = [];
  for (const allocation of depletion.allocations) {
    const batch = allocation.batchId ? byId.get(allocation.batchId) : undefined;
    const unitCost = batch?.costPriceMinor ?? null;
    const costMilli = batch
      ? takeCostMilli(
          batch.costTotalMinor,
          batch.receivedQuantityBase,
          allocation.quantityBase,
        )
      : null;
    running -= allocation.quantityBase;
    await tx.stockMovement.create({
      data: {
        storeId,
        storeVariantId: input.storeVariantId,
        storeProductId: input.storeProductId,
        batchId: allocation.batchId,
        type: input.type,
        quantityBase: -allocation.quantityBase,
        costPriceMinor: unitCost,
        balanceAfterBase: running,
        negative: allocation.isNegative || running < ZERO,
        saleLineId: input.saleLineId ?? null,
        wasteId: input.wasteId ?? null,
        opId: input.opId ?? null,
        createdAt: now,
      },
    });
    takes.push({
      batchId: allocation.batchId,
      quantityBase: allocation.quantityBase,
      unitCostPiasters: unitCost,
      costMilli,
    });
  }

  await writeLevelInTx(tx, storeId, input.storeVariantId, running, now);
  return {
    takes,
    costPiasters: sumTakeCosts(takes.map((t) => t.costMilli)),
    newBalance: running,
  };
}

/**
 * FEFO-depletes `quantityBase` of one variant for a sale (`type: "sale"` movements linked to
 * `saleLineId`). Shared by the ordinary, promotion and sandwich sales, so a sale and its stock
 * movements commit or roll back together. `costPiasters` is the cost of what was taken, from
 * the batches' recorded totals (null when any part's cost is unknown) — the cost a sale line
 * records (QA-07).
 */
export async function depleteVariantFefoInTx(
  tx: TenantTx,
  storeId: string,
  input: {
    storeVariantId: string;
    storeProductId: string | null;
    quantityBase: bigint;
    saleLineId: string | null;
    opId: string | null;
    now: Date;
  },
) {
  const result = await takeStockInTx(tx, storeId, { ...input, type: "sale" });
  return {
    allocations: result.takes.map((t) => ({
      batchId: t.batchId,
      quantityBase: Number(t.quantityBase),
      costPriceMinor:
        t.unitCostPiasters === null ? null : Number(t.unitCostPiasters),
      isNegative: t.batchId === null,
    })),
    shortfallBase: result.takes
      .filter((t) => t.batchId === null)
      .reduce((s, t) => s + Number(t.quantityBase), 0),
    newBalance: Number(result.newBalance),
    costPiasters:
      result.costPiasters === null ? null : Number(result.costPiasters),
  };
}

/**
 * Puts back exactly what a sale took, inside the caller's (void) transaction (ADR-0022,
 * QA-10). The sale's recorded takes are its `type: "sale"` movements (one per batch part, for
 * every line — products, promotion items and sandwich ingredients). For each one:
 * - the same quantity goes back to the SAME batch (or stays unbatched when the take had no
 *   batch), whatever the product's current price, batches or stock are;
 * - a `type: "sale_void"` movement of +quantity is appended, linked to the same sale line and
 *   carrying the take's unit cost, with the running ledger balance;
 * - the new ledger balance is written to `stock_levels`.
 *
 * The variants are locked first, in id order (ADR-0019). A line already restored (a
 * `sale_void` movement exists for it) is refused, so stock can never be restored twice.
 *
 * @returns the new balance of every variant that changed.
 */
export async function restoreSaleTakesInTx(
  tx: TenantTx,
  storeId: string,
  input: { saleLineIds: readonly string[]; opId: string; now: Date },
): Promise<Map<string, bigint>> {
  const { now } = input;
  if (input.saleLineIds.length === 0) return new Map();
  const takes = await tx.stockMovement.findMany({
    where: {
      storeId,
      saleLineId: { in: [...input.saleLineIds] },
      type: { in: ["sale", "sale_void"] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (takes.some((m) => m.type === "sale_void")) {
    throw AppError.conflict("البيعة دي اتلغت قبل كده");
  }

  const balances = await lockStockLevelsInTx(
    tx,
    storeId,
    takes.map((m) => m.storeVariantId),
  );
  const changed = new Map<string, bigint>();

  for (const take of takes) {
    const quantity = -take.quantityBase; // a take is recorded as a negative quantity
    if (quantity <= ZERO) continue;
    if (take.batchId) {
      const batch = await tx.storeStockBatch.findFirst({
        where: { id: take.batchId, storeId },
        select: { remainingQuantityBase: true, receivedQuantityBase: true },
      });
      if (
        !batch ||
        batch.remainingQuantityBase + quantity > batch.receivedQuantityBase
      ) {
        // Restoring would put more into the batch than it ever received: the ledger and the
        // batches disagree, so refuse rather than invent stock.
        throw AppError.conflict(
          "مقدرناش نرجّع كمية البيعة دي للمخزن — راجع المخزون",
        );
      }
      await tx.storeStockBatch.update({
        where: { id: take.batchId },
        data: {
          remainingQuantityBase: { increment: quantity },
          updatedAt: now,
        },
      });
    }
    const balance =
      (changed.get(take.storeVariantId) ??
        balances.get(take.storeVariantId) ??
        ZERO) + quantity;
    changed.set(take.storeVariantId, balance);
    await tx.stockMovement.create({
      data: {
        storeId,
        storeVariantId: take.storeVariantId,
        storeProductId: take.storeProductId,
        batchId: take.batchId,
        type: "sale_void",
        quantityBase: quantity,
        costPriceMinor: take.costPriceMinor,
        balanceAfterBase: balance,
        negative: balance < ZERO,
        saleLineId: take.saleLineId,
        opId: input.opId,
        createdAt: now,
      },
    });
  }

  for (const [variantId, balance] of changed) {
    await writeLevelInTx(tx, storeId, variantId, balance, now);
  }
  return changed;
}

/**
 * Puts back `quantityBase` of ONE sold line (a return, QA-31 / ADR-0027) inside the caller's
 * tenant transaction: into the batches the sale took from (the latest take first), never more
 * per batch than was taken minus what earlier returns already put back, with append-only
 * `sale_return` movements linked to the sale line and the new balance in `stock_levels`.
 *
 * The caller checks the returnable quantity; this refuses (409) only when the movements and the
 * batches disagree, rather than inventing stock.
 */
export async function restoreReturnInTx(
  tx: TenantTx,
  storeId: string,
  input: { saleLineId: string; quantityBase: bigint; opId: string; now: Date },
): Promise<{ variantId: string; balance: bigint } | null> {
  const { now } = input;
  const moves = await tx.stockMovement.findMany({
    where: {
      storeId,
      saleLineId: input.saleLineId,
      type: { in: ["sale", "sale_return"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const takes = moves.filter((m) => m.type === "sale");
  if (takes.length === 0) return null;
  const variantId = takes[0]!.storeVariantId;
  const balances = await lockStockLevelsInTx(tx, storeId, [variantId]);
  let balance = balances.get(variantId) ?? ZERO;

  // What each batch still "owes back" to this line: taken − already returned.
  const key = (b: string | null) => b ?? "unbatched";
  const open = new Map<string, bigint>();
  for (const t of takes)
    open.set(
      key(t.batchId),
      (open.get(key(t.batchId)) ?? ZERO) - t.quantityBase,
    );
  for (const r of moves.filter((m) => m.type === "sale_return")) {
    open.set(
      key(r.batchId),
      (open.get(key(r.batchId)) ?? ZERO) - r.quantityBase,
    );
  }

  let left = input.quantityBase;
  const seen = new Set<string>();
  for (const take of takes) {
    if (left <= ZERO) break;
    const k = key(take.batchId);
    if (seen.has(k)) continue;
    seen.add(k);
    const room = open.get(k) ?? ZERO;
    if (room <= ZERO) continue;
    const qty = room < left ? room : left;
    if (take.batchId) {
      const batch = await tx.storeStockBatch.findFirst({
        where: { id: take.batchId, storeId },
        select: { remainingQuantityBase: true, receivedQuantityBase: true },
      });
      if (
        !batch ||
        batch.remainingQuantityBase + qty > batch.receivedQuantityBase
      ) {
        throw AppError.conflict(
          "مقدرناش نرجّع الكمية دي للمخزن — راجع المخزون",
        );
      }
      await tx.storeStockBatch.update({
        where: { id: take.batchId },
        data: { remainingQuantityBase: { increment: qty }, updatedAt: now },
      });
    }
    balance += qty;
    await tx.stockMovement.create({
      data: {
        storeId,
        storeVariantId: variantId,
        storeProductId: take.storeProductId,
        batchId: take.batchId,
        type: "sale_return",
        quantityBase: qty,
        costPriceMinor: take.costPriceMinor,
        balanceAfterBase: balance,
        negative: balance < ZERO,
        saleLineId: input.saleLineId,
        opId: input.opId,
        createdAt: now,
      },
    });
    left -= qty;
  }
  if (left > ZERO) {
    throw AppError.conflict("مقدرناش نرجّع الكمية دي للمخزن — راجع المخزون");
  }
  await writeLevelInTx(tx, storeId, variantId, balance, now);
  return { variantId, balance };
}

/**
 * An `opId` that was already used must be a retry of the SAME operation (QA-27): the same
 * variant and the same kind of movement. Anything else is a 409 — the earlier operation is
 * neither repeated nor reported as this one.
 */
function assertSameStockOperation(
  existing: { storeVariantId: string; type: string },
  expected: { variantId: string; types: readonly string[] },
): void {
  if (
    existing.storeVariantId !== expected.variantId ||
    !expected.types.includes(existing.type)
  ) {
    throw AppError.conflict("رقم العملية ده اتسجل قبل كده لعملية مختلفة");
  }
}

/** Cost of one movement's quantity from its batch's recorded total (ADR-0021); null = unknown. */
function movementCostPiasters(m: {
  quantityBase: bigint;
  storeStockBatch: {
    costTotalMinor: bigint | null;
    receivedQuantityBase: bigint;
  } | null;
}): number | null {
  const batch = m.storeStockBatch;
  if (!batch) return null;
  const qty = m.quantityBase < ZERO ? -m.quantityBase : m.quantityBase;
  const milli = takeCostMilli(
    batch.costTotalMinor,
    batch.receivedQuantityBase,
    qty,
  );
  return milli === null ? null : Number(milliToWholePiasters(milli));
}

export class InventoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Adds a new inventory batch and records a "purchase" stock movement.
   * Transactional & Tenant-isolated.
   *
   * Cost (ADR-0021, QA-08): `costTotalMinor` is what was paid for the whole received quantity
   * (the Add-Stock screen asks for the total). The batch stores that total and the unit cost
   * per selling unit derived from it (per kg for `kg` products). `null` = cost unknown.
   */
  async addStockBatch(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      receivedQuantityBase: bigint | number;
      costTotalMinor: bigint | number | null;
      productionDate?: Date | string | null;
      expiryDate?: Date | string | null;
      batchCode?: string | null;
      supplierId?: string | null;
      opId?: string | null;
    },
  ) {
    const qtyBase = BigInt(input.receivedQuantityBase);
    const costTotal =
      input.costTotalMinor === null || input.costTotalMinor === undefined
        ? null
        : BigInt(input.costTotalMinor);
    if (costTotal !== null && costTotal < ZERO) {
      throw AppError.badRequest("سعر التكلفة يجب ألا يقل عن صفر");
    }
    if (qtyBase <= ZERO) {
      throw AppError.badRequest("كمية البضاعة المضافة يجب أن تكون أكبر من صفر");
    }

    const prodDate = input.productionDate
      ? new Date(input.productionDate)
      : null;
    const expiry = input.expiryDate ? new Date(input.expiryDate) : null;
    if (prodDate && expiry && expiry < prodDate) {
      throw AppError.badRequest(
        "تاريخ الانتهاء يجب ألا يكون قبل تاريخ الإنتاج",
      );
    }
    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Verify variant belongs to tenant store or resolve from global/store
        let variant = await tx.storeVariant.findFirst({
          where: { id: input.storeVariantId, storeId },
          select: { id: true, storeProductId: true },
        });

        if (!variant) {
          variant = await tx.storeVariant.findFirst({
            where: { globalVariantId: input.storeVariantId, storeId },
            select: { id: true, storeProductId: true },
          });
        }

        if (!variant) {
          const productVariant = await tx.storeVariant.findFirst({
            where: { storeProductId: input.storeVariantId, storeId },
            select: { id: true, storeProductId: true },
          });
          if (productVariant) {
            variant = productVariant;
          }
        }

        if (!variant) {
          const globalVariant = await tx.globalVariant.findUnique({
            where: { id: input.storeVariantId },
            include: { globalProduct: true },
          });

          if (globalVariant) {
            let storeProduct = await tx.storeProduct.findFirst({
              where: {
                storeId,
                globalProductId: globalVariant.globalProductId,
              },
              select: { id: true },
            });

            const nowTs = new Date();
            const newUnit =
              globalVariant.sizeUnit === "kg" || globalVariant.sizeUnit === "g"
                ? "kg"
                : "piece";
            // A catalog item added straight from stock intake: until the owner sets a price,
            // it starts at its unit cost (per selling unit), or 10 EGP when the cost is unknown.
            const unitCost = unitCostFromTotal(costTotal, qtyBase, newUnit);
            const startPrice =
              unitCost !== null && unitCost > ZERO ? unitCost : BigInt(1000);
            if (!storeProduct) {
              storeProduct = await tx.storeProduct.create({
                data: {
                  storeId,
                  globalProductId: globalVariant.globalProductId,
                  nameAr: globalVariant.globalProduct.nameAr,
                  nameNorm: globalVariant.globalProduct.nameNorm,
                  category: globalVariant.globalProduct.category,
                  unit: newUnit,
                  sellPricePiasters: startPrice,
                  isCustom: false,
                  isActive: true,
                  createdAt: nowTs,
                  updatedAt: nowTs,
                },
                select: { id: true },
              });
            }

            variant = await tx.storeVariant.create({
              data: {
                storeId,
                storeProductId: storeProduct.id,
                productId: globalVariant.globalProductId,
                globalVariantId: globalVariant.id,
                flavor: globalVariant.flavor,
                sizeValue: globalVariant.sizeValue,
                sizeUnit: globalVariant.sizeUnit,
                packQty: globalVariant.packQty,
                sellPricePiasters: startPrice,
                isActive: true,
                createdAt: nowTs,
                updatedAt: nowTs,
              },
              select: { id: true, storeProductId: true },
            });
          }
        }

        if (!variant) {
          throw AppError.notFound("الصنف غير موجود أو غير متاح في هذا المحل");
        }

        const resolvedVariantId = variant.id;

        // 2. Lock the variant's stock (ADR-0019), then check opId idempotency: a concurrent
        // retry waits here and then sees the first attempt's committed movement.
        const currentQty = await lockStockLevelInTx(
          tx,
          storeId,
          resolvedVariantId,
        );
        if (input.opId) {
          const existingMovement = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existingMovement) {
            assertSameStockOperation(existingMovement, {
              variantId: resolvedVariantId,
              types: ["purchase", "initial_stock"],
            });
            return {
              batchId: existingMovement.batchId,
              movementId: existingMovement.id,
              duplicate: true,
            };
          }
        }

        // 3. Create StoreStockBatch: the total paid, and the unit cost per selling unit
        const product = variant.storeProductId
          ? await tx.storeProduct.findFirst({
              where: { id: variant.storeProductId, storeId },
              select: { unit: true },
            })
          : null;
        const unitCost = unitCostFromTotal(costTotal, qtyBase, product?.unit);
        const batch = await tx.storeStockBatch.create({
          data: {
            storeId,
            storeVariantId: resolvedVariantId,
            storeProductId: variant.storeProductId,
            batchCode: input.batchCode ?? null,
            receivedQuantityBase: qtyBase,
            remainingQuantityBase: qtyBase,
            costPriceMinor: unitCost,
            costTotalMinor: costTotal,
            productionDate: prodDate,
            expiryDate: expiry,
            supplierId: input.supplierId ?? null,
            receivedAt: now,
            paid: true,
            createdAt: now,
            updatedAt: now,
          },
        });

        // 4. The new ledger balance, written to the stock level cache
        const newBalance = currentQty + qtyBase;
        await writeLevelInTx(tx, storeId, resolvedVariantId, newBalance, now);

        // 5. Create append-only StockMovement
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: resolvedVariantId,
            storeProductId: variant.storeProductId,
            batchId: batch.id,
            type: "purchase",
            quantityBase: qtyBase,
            costPriceMinor: unitCost,
            balanceAfterBase: newBalance,
            negative: false,
            opId: input.opId ?? null,
            createdAt: now,
          },
        });

        return {
          batchId: batch.id,
          movementId: movement.id,
          newBalance: Number(newBalance),
          duplicate: false,
        };
      },
      this.prisma,
    );
  }

  /**
   * Records waste (expired / damaged): a `waste_records` row and `type: "waste"` movements
   * that take the quantity out of the batches — FEFO, or only from `batchId` when the cashier
   * picked a batch (ADR-0021, QA-05). Batches, ledger and cache change together.
   *
   * The waste cost is the cost of what was taken, proportional to the batches' recorded totals
   * (0 when unknown — the column is required).
   *
   * @throws AppError 409 when the quantity is more than the stock (or than the chosen batch
   *   holds): batches cannot go negative, so recording it would break the stock invariant.
   */
  async recordWaste(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      quantityBase: bigint | number;
      batchId?: string | null;
      reason?: string;
      opId?: string | null;
    },
  ) {
    const qtyBase = BigInt(input.quantityBase);
    if (qtyBase <= ZERO) {
      throw AppError.badRequest(
        "الكمية المسجلة للهالك يجب أن تكون أكبر من صفر",
      );
    }

    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Verify variant
        const variant = await tx.storeVariant.findFirst({
          where: { id: input.storeVariantId, storeId },
          select: { id: true, storeProductId: true },
        });
        if (!variant) {
          throw AppError.notFound("الصنف غير موجود أو غير متاح في هذا المحل");
        }

        // 2. Lock the variant's stock (ADR-0019), then check opId idempotency
        const currentQty = await lockStockLevelInTx(tx, storeId, variant.id);
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            assertSameStockOperation(existing, {
              variantId: variant.id,
              types: ["waste"],
            });
            return { movementId: existing.id, duplicate: true };
          }
        }

        // 3. Availability: the stock, or the chosen batch
        if (qtyBase > currentQty) {
          throw AppError.conflict(
            `الكمية أكبر من المخزون (الموجود ${Number(currentQty < ZERO ? ZERO : currentQty)})`,
          );
        }
        if (input.batchId) {
          const batch = await tx.storeStockBatch.findFirst({
            where: { id: input.batchId, storeId, storeVariantId: variant.id },
            select: { remainingQuantityBase: true },
          });
          if (!batch) {
            throw AppError.notFound("التشغيلة أو الإضافة غير موجودة");
          }
          if (qtyBase > batch.remainingQuantityBase) {
            throw AppError.conflict(
              `التشغيلة دي فيها ${Number(batch.remainingQuantityBase)} بس`,
            );
          }
        }

        // 4. The waste record, then the take from the batches (movements link to it)
        const waste = await tx.wasteRecord.create({
          data: {
            storeId,
            storeVariantId: variant.id,
            batchId: input.batchId ?? null,
            quantityBase: qtyBase,
            costMinor: ZERO,
            reason: input.reason ?? "expired",
            createdAt: now,
          },
        });
        const taken = await takeStockInTx(tx, storeId, {
          storeVariantId: variant.id,
          storeProductId: variant.storeProductId,
          quantityBase: qtyBase,
          type: "waste",
          batchId: input.batchId ?? null,
          wasteId: waste.id,
          opId: input.opId ?? null,
          now,
        });
        if (taken.costPiasters !== null) {
          await tx.wasteRecord.update({
            where: { id: waste.id },
            data: { costMinor: taken.costPiasters },
          });
        }

        const firstMovement = await tx.stockMovement.findFirst({
          where: { storeId, wasteId: waste.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        return {
          wasteId: waste.id,
          movementId: firstMovement?.id ?? null,
          newBalance: Number(taken.newBalance),
          duplicate: false,
        };
      },
      this.prisma,
    );
  }

  /**
   * Depletes stock for a sale using FEFO (First-Expired, First-Out).
   * Generates append-only sale movements per batch or negative unbatched movement.
   * Transactional & Tenant-isolated.
   */
  async depleteStockForSale(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      quantityBase: bigint | number;
      saleLineId?: string | null;
      opId?: string | null;
    },
  ) {
    const qtyBase = BigInt(input.quantityBase);
    if (qtyBase <= ZERO) {
      throw AppError.badRequest("كمية البيع يجب أن تكون أكبر من صفر");
    }

    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const variant = await tx.storeVariant.findFirst({
          where: { id: input.storeVariantId, storeId },
          select: { id: true, storeProductId: true },
        });
        if (!variant) {
          throw AppError.notFound("الصنف غير موجود أو غير متاح في هذا المحل");
        }

        // Lock the variant's stock (ADR-0019), then check opId idempotency
        await lockStockLevelInTx(tx, storeId, variant.id);
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            return { duplicate: true };
          }
        }

        const result = await depleteVariantFefoInTx(tx, storeId, {
          storeVariantId: input.storeVariantId,
          storeProductId: variant.storeProductId,
          quantityBase: qtyBase,
          saleLineId: input.saleLineId ?? null,
          opId: input.opId ?? null,
          now,
        });

        return {
          duplicate: false,
          allocations: result.allocations,
          shortfallBase: result.shortfallBase,
          newBalance: result.newBalance,
        };
      },
      this.prisma,
    );
  }

  /**
   * Retrieves all stock levels, active batches, and product details for a store.
   */
  async getStoreInventory(storeId: string, userId: string | null) {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const variants = await tx.storeVariant.findMany({
          where: { storeId, isActive: true },
          include: {
            storeProduct: true,
            stockLevels: true,
            storeStockBatches: {
              where: { remainingQuantityBase: { gt: ZERO } },
              orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
            },
          },
        });

        const now = new Date();

        return variants.map((v) => {
          const currentQty = v.stockLevels[0]?.quantityBase ?? ZERO;
          const batches = v.storeStockBatches.map((b) => ({
            id: b.id,
            batchCode: b.batchCode,
            receivedQty: Number(b.receivedQuantityBase),
            remainingQty: Number(b.remainingQuantityBase),
            // Unit cost per selling unit and the batch total; null = unknown (ADR-0021)
            costPricePiasters:
              b.costPriceMinor === null ? null : Number(b.costPriceMinor),
            costTotalPiasters:
              b.costTotalMinor === null ? null : Number(b.costTotalMinor),
            expiryDate: b.expiryDate ? b.expiryDate.toISOString() : null,
            isNearExpiry: isNearExpiry(b.expiryDate, now, 7),
            receivedAt: b.receivedAt.toISOString(),
          }));

          const hasNearExpiry = batches.some((b) => b.isNearExpiry);
          // The documented stock-level rule (QA-52): 3 kg, two packs or 10 pieces.
          const status = stockLevel(
            v.storeProduct?.unit === "kg" ? "weight" : "piece",
            v.packQty,
            Number(currentQty),
          );

          return {
            variantId: v.id,
            productId: v.storeProductId,
            productName: v.storeProduct?.nameAr ?? "",
            category: v.storeProduct?.category ?? "",
            isCustom: v.storeProduct?.isCustom ?? false,
            flavor: v.flavor,
            unitMode: v.storeProduct?.unit === "kg" ? "weight" : "piece",
            unit: v.storeProduct?.unit ?? "piece",
            packQty: v.packQty,
            packName: v.sizeUnit ?? null,
            sellPricePiasters: Number(v.sellPricePiasters),
            buyPricePiasters: v.buyPricePiasters
              ? Number(v.buyPricePiasters)
              : 0,
            currentStockBase: Number(currentQty),
            status,
            hasNearExpiry,
            batches,
          };
        });
      },
      this.prisma,
    );
  }

  /**
   * Reverses / voids an added stock batch.
   * Transactional & Tenant-isolated.
   * Decrements remaining batch stock, updates stock_levels balance, and creates an append-only "purchase_void" movement.
   */
  async voidStockBatch(
    storeId: string,
    userId: string | null,
    input: {
      batchId: string;
      reason?: string;
      opId?: string | null;
    },
  ) {
    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Find the batch's variant, lock its stock (ADR-0019), then re-read the batch so
        // its remaining quantity reflects every operation committed before the lock.
        const found = await tx.storeStockBatch.findFirst({
          where: { id: input.batchId, storeId },
          select: { storeVariantId: true },
        });
        if (!found) {
          throw AppError.notFound("التشغيلة أو الإضافة غير موجودة");
        }
        const currentQty = await lockStockLevelInTx(
          tx,
          storeId,
          found.storeVariantId,
        );
        const batch = await tx.storeStockBatch.findFirst({
          where: { id: input.batchId, storeId },
        });
        if (!batch) {
          throw AppError.notFound("التشغيلة أو الإضافة غير موجودة");
        }

        // 2. Check opId idempotency
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            return { duplicate: true };
          }
        }

        const voidQty = batch.remainingQuantityBase;
        if (voidQty <= ZERO) {
          throw AppError.badRequest(
            "تم بيع أو صرف كمية هذه التشغيلة بالكامل ولا يمكن التراجع عنها",
          );
        }

        // 3. Mark batch remaining as 0
        await tx.storeStockBatch.update({
          where: { id: batch.id },
          data: {
            remainingQuantityBase: ZERO,
            updatedAt: now,
          },
        });

        // 4. The new ledger balance, written to the stock level cache
        const newBalance = currentQty - voidQty;
        await writeLevelInTx(
          tx,
          storeId,
          batch.storeVariantId,
          newBalance,
          now,
        );

        // 5. Append-only reversing StockMovement
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: batch.storeVariantId,
            storeProductId: batch.storeProductId,
            batchId: batch.id,
            type: "purchase_void",
            quantityBase: -voidQty,
            costPriceMinor: batch.costPriceMinor,
            balanceAfterBase: newBalance,
            negative: newBalance < ZERO,
            opId: input.opId ?? null,
            createdAt: now,
          },
        });

        return {
          batchId: batch.id,
          movementId: movement.id,
          voidedQuantity: Number(voidQty),
          newBalance: Number(newBalance),
        };
      },
      this.prisma,
    );
  }

  /**
   * Adjusts stock quantity for a variant.
   * Supports:
   * 1) mode === "set": Sets final balance to `targetQuantityBase` (a negative target is
   *    rejected with 400).
   * 2) mode === "delta": Increments or decrements balance by `deltaQuantityBase`. A decrement
   *    larger than the current stock is rejected with 409 and nothing is written (QA-16).
   * Enforces tenant isolation and append-only audit trail; `opId` makes a retry a no-op.
   *
   * Batches (ADR-0021, QA-05): an increase adds an adjustment batch costed at the registered
   * buy price (unknown when none); a decrease takes the quantity out of the batches FEFO with
   * one `type: "adjustment"` movement per batch part — so batches, ledger and cache agree.
   */
  async adjustStockQuantity(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      mode: "set" | "delta";
      targetQuantityBase?: number | bigint;
      deltaQuantityBase?: number | bigint;
      reason?: string;
      opId?: string | null;
    },
  ) {
    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Verify variant
        const variant = await tx.storeVariant.findFirst({
          where: {
            storeId,
            OR: [
              { id: input.storeVariantId },
              { storeProductId: input.storeVariantId },
            ],
          },
          include: { storeProduct: true },
        });
        if (!variant) {
          throw AppError.notFound("الصنف غير موجود أو غير متاح في هذا المحل");
        }

        // 2. Lock the variant's stock (ADR-0019): the current (ledger) balance below is the
        // latest committed one, and no other operation can change it until this one commits.
        const currentQty = await lockStockLevelInTx(tx, storeId, variant.id);

        // 3. Check opId idempotency (after the lock, so a concurrent retry sees the first)
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            assertSameStockOperation(existing, {
              variantId: variant.id,
              types: ["adjustment"],
            });
            return {
              variantId: variant.id,
              movementId: existing.id,
              newBalance: Number(existing.balanceAfterBase ?? 0),
              duplicate: true,
            };
          }
        }

        let delta: bigint;
        if (input.mode === "set") {
          const target = BigInt(input.targetQuantityBase ?? 0);
          if (target < ZERO) {
            throw AppError.badRequest("الرصيد الفعلي لا يمكن أن يكون سالباً");
          }
          delta = target - currentQty;
        } else {
          delta = BigInt(input.deltaQuantityBase ?? 0);
          if (currentQty + delta < ZERO) {
            // Rejected, never floored (QA-16, decision D31): nothing is written, the stock
            // stays as it was, and the cashier is told what is actually there.
            throw new AppError(
              "CONFLICT",
              "الكمية الناتجة بعد الخصم لا يمكن أن تكون سالبة",
              409,
              {
                availableBase: Number(currentQty < ZERO ? ZERO : currentQty),
                requestedBase: Number(-delta),
              },
            );
          }
        }

        if (delta === ZERO) {
          return {
            variantId: variant.id,
            movementId: null,
            adjustedDelta: 0,
            newBalance: Number(currentQty),
            duplicate: false,
          };
        }

        if (delta > ZERO) {
          // Increase: an adjustment batch, costed at the registered buy price per selling
          // unit (variant, else product); unknown (null) when there is none.
          const unitPrice =
            variant.buyPricePiasters && variant.buyPricePiasters > ZERO
              ? variant.buyPricePiasters
              : variant.storeProduct?.buyPricePiasters &&
                  variant.storeProduct.buyPricePiasters > ZERO
                ? variant.storeProduct.buyPricePiasters
                : null;
          const total = totalFromUnitCost(
            unitPrice,
            delta,
            variant.storeProduct?.unit,
          );
          const batch = await tx.storeStockBatch.create({
            data: {
              storeId,
              storeVariantId: variant.id,
              storeProductId: variant.storeProductId,
              batchCode: `ADJ-${Date.now().toString(36).toUpperCase()}`,
              receivedQuantityBase: delta,
              remainingQuantityBase: delta,
              costPriceMinor: unitPrice,
              costTotalMinor: total,
              receivedAt: now,
              paid: true,
            },
          });
          const newBalance = currentQty + delta;
          await writeLevelInTx(tx, storeId, variant.id, newBalance, now);
          const movement = await tx.stockMovement.create({
            data: {
              storeId,
              storeVariantId: variant.id,
              storeProductId: variant.storeProductId,
              batchId: batch.id,
              type: "adjustment",
              quantityBase: delta,
              costPriceMinor: unitPrice,
              balanceAfterBase: newBalance,
              negative: newBalance < ZERO,
              opId: input.opId ?? null,
              createdAt: now,
            },
          });
          return {
            variantId: variant.id,
            movementId: movement.id,
            adjustedDelta: Number(delta),
            newBalance: Number(newBalance),
            duplicate: false,
          };
        }

        // Decrease: take the quantity out of the batches (FEFO), one movement per part.
        const taken = await takeStockInTx(tx, storeId, {
          storeVariantId: variant.id,
          storeProductId: variant.storeProductId,
          quantityBase: -delta,
          type: "adjustment",
          opId: input.opId ?? null,
          now,
        });
        const first = await tx.stockMovement.findFirst({
          where: {
            storeId,
            storeVariantId: variant.id,
            type: "adjustment",
            createdAt: now,
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        return {
          variantId: variant.id,
          movementId: first?.id ?? null,
          adjustedDelta: Number(delta),
          newBalance: Number(taken.newBalance),
          duplicate: false,
        };
      },
      this.prisma,
    );
  }

  /**
   * Archives a variant from the active inventory view (sets isActive = false).
   * Strict safety check: ONLY permitted if the current stock level is 0.
   * If current stock > 0, throws AppError.badRequest to prevent hidden inventory.
   */
  async archiveVariantFromView(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      opId?: string | null;
    },
  ) {
    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Verify variant
        const variant = await tx.storeVariant.findFirst({
          where: {
            storeId,
            OR: [
              { id: input.storeVariantId },
              { storeProductId: input.storeVariantId },
            ],
          },
          include: { storeProduct: true },
        });
        if (!variant) {
          throw AppError.notFound("الصنف غير موجود في هذا المحل");
        }

        // 2. Check current stock level under the stock lock (ADR-0019), so stock added
        // concurrently cannot end up on an archived variant
        const currentQty = await lockStockLevelInTx(tx, storeId, variant.id);

        if (currentQty > ZERO) {
          throw AppError.badRequest(
            "لا يمكن إزالة الصنف من قائمة المخزون النشطة لأن رصيده الحالي موجب. عدّل الكمية لـ 0 الأول.",
          );
        }

        // 3. Mark variant as inactive
        await tx.storeVariant.update({
          where: { id: variant.id },
          data: {
            isActive: false,
            updatedAt: now,
          },
        });

        return {
          variantId: variant.id,
          archived: true,
        };
      },
      this.prisma,
    );
  }

  /**
   * Stock reconciliation (ADR-0021, QA-05): for each variant of the store (or one variant),
   * the three records of its quantity — the `stock_levels` cache, the sum of its batches'
   * remaining quantities, and the movement ledger. They must be equal; `consistent` is false
   * when they are not. Read-only: it reports, it never repairs.
   */
  async getStockReconciliation(
    storeId: string,
    userId: string | null,
    options: { variantId?: string } = {},
  ): Promise<
    Array<{
      variantId: string;
      levelBase: number;
      batchesRemainingBase: number;
      ledgerBase: number;
      consistent: boolean;
    }>
  > {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const variantFilter = options.variantId
          ? Prisma.sql`AND v.id = ${options.variantId}::uuid`
          : Prisma.empty;
        const rows = await tx.$queryRaw<
          Array<{
            variant_id: string;
            level: bigint;
            batches: bigint;
            ledger: bigint;
          }>
        >`SELECT v.id::text AS variant_id,
                 COALESCE((SELECT l.quantity_base FROM stock_levels l
                            WHERE l.store_id = v.store_id AND l.store_variant_id = v.id), 0)::bigint AS level,
                 COALESCE((SELECT SUM(b.remaining_quantity_base) FROM store_stock_batches b
                            WHERE b.store_id = v.store_id AND b.store_variant_id = v.id), 0)::bigint AS batches,
                 COALESCE((SELECT SUM(m.quantity_base) FROM stock_movements m
                            WHERE m.store_id = v.store_id AND m.store_variant_id = v.id), 0)::bigint AS ledger
            FROM store_variants v
           WHERE v.store_id = ${storeId}::uuid
             ${variantFilter}`;
        return rows.map((r) => ({
          variantId: r.variant_id,
          levelBase: Number(r.level),
          batchesRemainingBase: Number(r.batches),
          ledgerBase: Number(r.ledger),
          consistent:
            BigInt(r.level) === BigInt(r.ledger) &&
            BigInt(r.batches) === BigInt(r.ledger),
        }));
      },
      this.prisma,
    );
  }

  /**
   * Retrieves stock movements log for a store.
   */
  async getStockMovements(
    storeId: string,
    userId: string | null,
    options?: { limit?: number; variantId?: string },
  ) {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const movements = await tx.stockMovement.findMany({
          where: {
            storeId,
            ...(options?.variantId
              ? { storeVariantId: options.variantId }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          take: options?.limit ?? 100,
          include: {
            storeVariant: {
              include: { storeProduct: true },
            },
            storeStockBatch: true,
          },
        });

        const supplierIds = movements
          .map((m) => m.storeStockBatch?.supplierId)
          .filter((id): id is string => Boolean(id));

        const suppliers =
          supplierIds.length > 0
            ? await tx.supplier.findMany({
                where: { storeId, id: { in: supplierIds } },
                select: { id: true, nameAr: true },
              })
            : [];
        const supplierMap = new Map(suppliers.map((s) => [s.id, s.nameAr]));

        return movements.map((m) => ({
          id: m.id,
          batchId: m.batchId,
          variantId: m.storeVariantId,
          productName: m.storeVariant.storeProduct?.nameAr ?? "",
          flavor: m.storeVariant.flavor,
          packQty: m.storeVariant.packQty,
          unitMode:
            m.storeVariant.storeProduct?.unit === "kg" ||
            m.storeVariant.storeProduct?.unit === "g"
              ? ("weight" as const)
              : ("piece" as const),
          type: m.type,
          quantityBase: Number(m.quantityBase),
          costPricePiasters:
            m.costPriceMinor === null ? null : Number(m.costPriceMinor),
          // Cost of THIS movement's quantity: its share of the batch's recorded total
          // (the whole total for the movement that received the batch). Null = unknown.
          costTotalMinor: movementCostPiasters(m),
          supplierName: m.storeStockBatch?.supplierId
            ? (supplierMap.get(m.storeStockBatch.supplierId) ?? null)
            : null,
          balanceAfterBase: m.balanceAfterBase
            ? Number(m.balanceAfterBase)
            : null,
          negative: m.negative,
          batchCode: m.storeStockBatch?.batchCode ?? null,
          expiryDate: m.storeStockBatch?.expiryDate
            ? m.storeStockBatch.expiryDate.toISOString()
            : null,
          createdAt: m.createdAt.toISOString(),
        }));
      },
      this.prisma,
    );
  }
}
