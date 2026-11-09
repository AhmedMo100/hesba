import "server-only";
import { PrismaClient } from "@prisma/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  depleteStockFEFO,
  isNearExpiry,
  type StockBatchCandidate,
} from "@/domain/stock/stock-engine";

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
 *   `opId` already exists for the store.
 * - Batch and level updates are read-then-write within the transaction (no row locks).
 * - `depleteStockForSale` is not called by any route handler today; the sales screen deducts
 *   stock through `adjustStockQuantity` in delta mode. Its FEFO core,
 *   `depleteVariantFefoInTx`, is also used by the sandwich sale path (ADR-0018).
 */

const ZERO = BigInt(0);

/**
 * FEFO-depletes `quantityBase` of one variant inside the caller's tenant transaction: updates
 * the batches it draws from, appends one `type: "sale"` movement per allocation (linked to
 * `saleLineId`), and writes the new `stock_levels` balance.
 *
 * Shared by {@link InventoryService.depleteStockForSale} and the sandwich sale path, so a sale
 * and its stock movements commit or roll back together. It performs no availability check
 * and takes no locks: callers that must not go below zero check and lock first. Quantity not
 * covered by batches becomes an unbatched allocation flagged `negative` (stock-engine rule 6).
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
  const { now } = input;
  const batches = await tx.storeStockBatch.findMany({
    where: {
      storeId,
      storeVariantId: input.storeVariantId,
      remainingQuantityBase: { gt: ZERO },
    },
  });

  const candidates: StockBatchCandidate[] = batches.map((b) => ({
    id: b.id,
    storeVariantId: b.storeVariantId,
    batchCode: b.batchCode,
    remainingQuantityBase: b.remainingQuantityBase,
    costPriceMinor: b.costPriceMinor,
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

  const currentLevel = await tx.stockLevel.findUnique({
    where: {
      storeId_storeVariantId: {
        storeId,
        storeVariantId: input.storeVariantId,
      },
    },
  });

  let runningBalance = currentLevel?.quantityBase ?? ZERO;

  for (const allocation of depletion.allocations) {
    runningBalance -= allocation.quantityBase;
    await tx.stockMovement.create({
      data: {
        storeId,
        storeVariantId: input.storeVariantId,
        storeProductId: input.storeProductId,
        batchId: allocation.batchId,
        type: "sale",
        quantityBase: -allocation.quantityBase,
        costPriceMinor: allocation.costPriceMinor,
        balanceAfterBase: runningBalance,
        negative: allocation.isNegative,
        saleLineId: input.saleLineId,
        opId: input.opId,
        createdAt: now,
      },
    });
  }

  await tx.stockLevel.upsert({
    where: {
      storeId_storeVariantId: {
        storeId,
        storeVariantId: input.storeVariantId,
      },
    },
    update: {
      quantityBase: runningBalance,
      updatedAt: now,
    },
    create: {
      storeId,
      storeVariantId: input.storeVariantId,
      quantityBase: runningBalance,
      updatedAt: now,
    },
  });

  return {
    allocations: depletion.allocations.map((a) => ({
      batchId: a.batchId,
      quantityBase: Number(a.quantityBase),
      costPriceMinor: Number(a.costPriceMinor),
      isNegative: a.isNegative,
    })),
    shortfallBase: Number(depletion.shortfallBase),
    newBalance: Number(runningBalance),
  };
}

/**
 * A variant with at most this many base units in stock is reported as "low" (5 pieces, or
 * 5 grams for weighed items).
 */
const FIVE = BigInt(5);

export class InventoryService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Adds a new inventory batch and records a "purchase" stock movement.
   * Transactional & Tenant-isolated.
   */
  async addStockBatch(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      receivedQuantityBase: bigint | number;
      costPriceMinor: bigint | number;
      productionDate?: Date | string | null;
      expiryDate?: Date | string | null;
      batchCode?: string | null;
      supplierId?: string | null;
      opId?: string | null;
    },
  ) {
    const qtyBase = BigInt(input.receivedQuantityBase);
    const costMinor = BigInt(input.costPriceMinor);
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
            if (!storeProduct) {
              storeProduct = await tx.storeProduct.create({
                data: {
                  storeId,
                  globalProductId: globalVariant.globalProductId,
                  nameAr: globalVariant.globalProduct.nameAr,
                  nameNorm: globalVariant.globalProduct.nameNorm,
                  category: globalVariant.globalProduct.category,
                  unit:
                    globalVariant.sizeUnit === "kg" ||
                    globalVariant.sizeUnit === "g"
                      ? "kg"
                      : "piece",
                  sellPricePiasters:
                    costMinor > ZERO ? costMinor : BigInt(1000),
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
                sellPricePiasters: costMinor > ZERO ? costMinor : BigInt(1000),
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

        // 2. Check opId idempotency if provided
        if (input.opId) {
          const existingMovement = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existingMovement) {
            return {
              batchId: existingMovement.batchId,
              movementId: existingMovement.id,
              duplicate: true,
            };
          }
        }

        // 3. Create StoreStockBatch
        const batch = await tx.storeStockBatch.create({
          data: {
            storeId,
            storeVariantId: resolvedVariantId,
            storeProductId: variant.storeProductId,
            batchCode: input.batchCode ?? null,
            receivedQuantityBase: qtyBase,
            remainingQuantityBase: qtyBase,
            costPriceMinor: costMinor,
            costTotalMinor: costMinor * qtyBase,
            productionDate: prodDate,
            expiryDate: expiry,
            supplierId: input.supplierId ?? null,
            receivedAt: now,
            paid: true,
            createdAt: now,
            updatedAt: now,
          },
        });

        // 4. Update / create stock level cache
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: resolvedVariantId,
            },
          },
        });

        const newBalance = (currentLevel?.quantityBase ?? ZERO) + qtyBase;

        await tx.stockLevel.upsert({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: resolvedVariantId,
            },
          },
          update: {
            quantityBase: newBalance,
            updatedAt: now,
          },
          create: {
            storeId,
            storeVariantId: resolvedVariantId,
            quantityBase: newBalance,
            updatedAt: now,
          },
        });

        // 5. Create append-only StockMovement
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: resolvedVariantId,
            storeProductId: variant.storeProductId,
            batchId: batch.id,
            type: "purchase",
            quantityBase: qtyBase,
            costPriceMinor: costMinor,
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
   * Records a waste / expired / damaged stock event and creates a "waste" movement.
   * Transactional & Tenant-isolated.
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

        // 2. Check opId idempotency
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            return { movementId: existing.id, duplicate: true };
          }
        }

        let costMinor = ZERO;

        // 3. If batchId provided, verify and deplete batch
        if (input.batchId) {
          const batch = await tx.storeStockBatch.findFirst({
            where: { id: input.batchId, storeId },
          });
          if (batch) {
            costMinor = batch.costPriceMinor;
            const updatedRemaining =
              batch.remainingQuantityBase > qtyBase
                ? batch.remainingQuantityBase - qtyBase
                : ZERO;

            await tx.storeStockBatch.update({
              where: { id: batch.id },
              data: {
                remainingQuantityBase: updatedRemaining,
                updatedAt: now,
              },
            });
          }
        }

        // 4. Create WasteRecord
        const waste = await tx.wasteRecord.create({
          data: {
            storeId,
            storeVariantId: input.storeVariantId,
            batchId: input.batchId ?? null,
            quantityBase: qtyBase,
            costMinor: costMinor * qtyBase,
            reason: input.reason ?? "expired",
            createdAt: now,
          },
        });

        // 5. Update stock_levels
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: input.storeVariantId,
            },
          },
        });

        const newBalance = (currentLevel?.quantityBase ?? ZERO) - qtyBase;

        await tx.stockLevel.upsert({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: input.storeVariantId,
            },
          },
          update: {
            quantityBase: newBalance,
            updatedAt: now,
          },
          create: {
            storeId,
            storeVariantId: input.storeVariantId,
            quantityBase: newBalance,
            updatedAt: now,
          },
        });

        // 6. Append-only StockMovement
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: input.storeVariantId,
            storeProductId: variant.storeProductId,
            batchId: input.batchId ?? null,
            type: "waste",
            quantityBase: -qtyBase,
            costPriceMinor: costMinor,
            balanceAfterBase: newBalance,
            negative: newBalance < ZERO,
            wasteId: waste.id,
            opId: input.opId ?? null,
            createdAt: now,
          },
        });

        return {
          wasteId: waste.id,
          movementId: movement.id,
          newBalance: Number(newBalance),
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

        // Check opId idempotency
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
            costPricePiasters: Number(b.costPriceMinor),
            expiryDate: b.expiryDate ? b.expiryDate.toISOString() : null,
            isNearExpiry: isNearExpiry(b.expiryDate, now, 7),
            receivedAt: b.receivedAt.toISOString(),
          }));

          const hasNearExpiry = batches.some((b) => b.isNearExpiry);
          const status =
            currentQty <= ZERO ? "out" : currentQty <= FIVE ? "low" : "ok";

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
        // 1. Verify batch
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

        // 4. Update stock_levels
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: batch.storeVariantId,
            },
          },
        });

        const newBalance = (currentLevel?.quantityBase ?? ZERO) - voidQty;

        await tx.stockLevel.upsert({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: batch.storeVariantId,
            },
          },
          update: {
            quantityBase: newBalance,
            updatedAt: now,
          },
          create: {
            storeId,
            storeVariantId: batch.storeVariantId,
            quantityBase: newBalance,
            updatedAt: now,
          },
        });

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
   *    larger than the current stock is floored: the balance becomes 0 and the recorded delta
   *    is reduced to `-current`, so the cashier can keep selling when stock intake was never
   *    recorded.
   * Enforces tenant isolation and append-only audit trail; `opId` makes a retry a no-op.
   *
   * @remarks The sales screen uses delta mode to deduct sold quantities.
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

        // 2. Check opId idempotency
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            return {
              variantId: variant.id,
              movementId: existing.id,
              newBalance: Number(existing.balanceAfterBase ?? 0),
              duplicate: true,
            };
          }
        }

        // 3. Current balance
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: variant.id,
            },
          },
        });
        const currentQty = currentLevel?.quantityBase ?? ZERO;

        let delta: bigint;
        let newBalance: bigint;

        if (input.mode === "set") {
          const target = BigInt(input.targetQuantityBase ?? 0);
          if (target < ZERO) {
            throw AppError.badRequest("الرصيد الفعلي لا يمكن أن يكون سالباً");
          }
          newBalance = target;
          delta = target - currentQty;
        } else {
          delta = BigInt(input.deltaQuantityBase ?? 0);
          newBalance = currentQty + delta;
          if (newBalance < ZERO) {
            // Floor balance to ZERO so cashiers can still sell even if stock intake wasn't recorded yet
            newBalance = ZERO;
            delta = -currentQty;
          }
        }

        if (delta === ZERO) {
          return {
            variantId: variant.id,
            movementId: null,
            adjustedDelta: 0,
            newBalance: Number(newBalance),
            duplicate: false,
          };
        }

        let createdBatchId: string | null = null;
        const buyCost = variant.buyPricePiasters ?? ZERO;

        if (delta > ZERO) {
          // Increase stock: create an adjustment batch
          const batch = await tx.storeStockBatch.create({
            data: {
              storeId,
              storeVariantId: variant.id,
              storeProductId: variant.storeProductId,
              batchCode: `ADJ-${Date.now().toString(36).toUpperCase()}`,
              receivedQuantityBase: delta,
              remainingQuantityBase: delta,
              costPriceMinor: buyCost,
              costTotalMinor: buyCost * delta,
              receivedAt: now,
              paid: true,
            },
          });
          createdBatchId = batch.id;
        } else {
          // Decrease stock: deplete active batches using FEFO
          const qtyToDeduct = -delta;
          const activeBatches = await tx.storeStockBatch.findMany({
            where: {
              storeId,
              storeVariantId: variant.id,
              remainingQuantityBase: { gt: ZERO },
            },
            orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
          });

          const candidates: StockBatchCandidate[] = activeBatches.map((b) => ({
            id: b.id,
            storeVariantId: b.storeVariantId,
            remainingQuantityBase: b.remainingQuantityBase,
            costPriceMinor: b.costPriceMinor,
            expiryDate: b.expiryDate,
            receivedAt: b.receivedAt,
          }));

          const depletion = depleteStockFEFO(candidates, qtyToDeduct);
          for (const updated of depletion.updatedBatches) {
            await tx.storeStockBatch.update({
              where: { id: updated.id },
              data: {
                remainingQuantityBase: updated.remainingQuantityBase,
                updatedAt: now,
              },
            });
          }
        }

        // 4. Update stock levels
        await tx.stockLevel.upsert({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: variant.id,
            },
          },
          update: {
            quantityBase: newBalance,
            updatedAt: now,
          },
          create: {
            storeId,
            storeVariantId: variant.id,
            quantityBase: newBalance,
            updatedAt: now,
          },
        });

        // 5. Append-only adjustment movement
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: variant.id,
            storeProductId: variant.storeProductId,
            batchId: createdBatchId,
            type: "adjustment",
            quantityBase: delta,
            costPriceMinor: buyCost,
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
      },
      this.prisma,
    );
  }

  /**
   * Clears all stock for a variant (zeros remaining on all active batches and stock level).
   * Records an adjustment movement.
   * Optionally soft-removes the variant from active inventory view (isActive = false).
   */
  async clearVariantStock(
    storeId: string,
    userId: string | null,
    input: {
      storeVariantId: string;
      reason?: string;
      removeFromView?: boolean;
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

        // 2. Check opId idempotency
        if (input.opId) {
          const existing = await tx.stockMovement.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            return {
              variantId: variant.id,
              movementId: existing.id,
              clearedQuantity: Number(
                existing.quantityBase ? -existing.quantityBase : 0,
              ),
              duplicate: true,
            };
          }
        }

        // 3. Current stock
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: variant.id,
            },
          },
        });
        const currentQty = currentLevel?.quantityBase ?? ZERO;

        // 4. Zero all active batches
        await tx.storeStockBatch.updateMany({
          where: {
            storeId,
            storeVariantId: variant.id,
            remainingQuantityBase: { gt: ZERO },
          },
          data: {
            remainingQuantityBase: ZERO,
            updatedAt: now,
          },
        });

        // 5. Zero stock_level
        await tx.stockLevel.upsert({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: variant.id,
            },
          },
          update: {
            quantityBase: ZERO,
            updatedAt: now,
          },
          create: {
            storeId,
            storeVariantId: variant.id,
            quantityBase: ZERO,
            updatedAt: now,
          },
        });

        // 6. Record adjustment movement if there was stock
        let movementId: string | null = null;
        if (currentQty > ZERO) {
          const movement = await tx.stockMovement.create({
            data: {
              storeId,
              storeVariantId: variant.id,
              storeProductId: variant.storeProductId,
              batchId: null,
              type: "adjustment",
              quantityBase: -currentQty,
              costPriceMinor: variant.buyPricePiasters ?? ZERO,
              balanceAfterBase: ZERO,
              negative: false,
              opId: input.opId ?? null,
              createdAt: now,
            },
          });
          movementId = movement.id;
        }

        // 7. If removeFromView is true, deactivate variant
        if (input.removeFromView) {
          await tx.storeVariant.update({
            where: { id: variant.id },
            data: {
              isActive: false,
              updatedAt: now,
            },
          });
        }

        return {
          variantId: variant.id,
          movementId,
          clearedQuantity: Number(currentQty),
          removedFromView: Boolean(input.removeFromView),
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

        // 2. Check current stock level
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: variant.id,
            },
          },
        });
        const currentQty = currentLevel?.quantityBase ?? ZERO;

        if (currentQty > ZERO) {
          throw AppError.badRequest(
            "لا يمكن إزالة الصنف من قائمة المخزون النشطة لأن رصيده الحالي موجب. يرجى تصفير المخزون أولاً.",
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
          costPricePiasters: m.costPriceMinor ? Number(m.costPriceMinor) : null,
          costTotalMinor: m.storeStockBatch?.costTotalMinor
            ? Number(m.storeStockBatch.costTotalMinor)
            : m.costPriceMinor
              ? Number(m.costPriceMinor) * Number(m.quantityBase)
              : null,
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
