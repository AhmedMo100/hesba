import "server-only";
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import {
  depleteStockFEFO,
  isNearExpiry,
  type StockBatchCandidate,
} from "@/domain/stock/stock-engine";

const ZERO = BigInt(0);
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
      expiryDate?: Date | string | null;
      batchCode?: string | null;
      supplierId?: string | null;
      opId?: string | null;
    },
  ) {
    const qtyBase = BigInt(input.receivedQuantityBase);
    const costMinor = BigInt(input.costPriceMinor);
    if (qtyBase <= ZERO) {
      throw new Error("Received quantity must be positive");
    }

    const expiry = input.expiryDate ? new Date(input.expiryDate) : null;
    const now = new Date();

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Verify variant belongs to tenant store
        const variant = await tx.storeVariant.findFirst({
          where: { id: input.storeVariantId, storeId },
          select: { id: true, storeProductId: true },
        });
        if (!variant) {
          throw new Error("Variant not found or unauthorized");
        }

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
            storeVariantId: input.storeVariantId,
            storeProductId: variant.storeProductId,
            batchCode: input.batchCode ?? null,
            receivedQuantityBase: qtyBase,
            remainingQuantityBase: qtyBase,
            costPriceMinor: costMinor,
            costTotalMinor: costMinor * qtyBase,
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
              storeVariantId: input.storeVariantId,
            },
          },
        });

        const newBalance = (currentLevel?.quantityBase ?? ZERO) + qtyBase;

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

        // 5. Create append-only StockMovement
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: input.storeVariantId,
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
      throw new Error("Waste quantity must be positive");
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
          throw new Error("Variant not found or unauthorized");
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
      throw new Error("Sale quantity must be positive");
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
          throw new Error("Variant not found or unauthorized");
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

        // Fetch active batches with remaining quantity
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

        // Execute pure FEFO depletion
        const depletion = depleteStockFEFO(candidates, qtyBase);

        // Update batches
        for (const updated of depletion.updatedBatches) {
          await tx.storeStockBatch.update({
            where: { id: updated.id },
            data: {
              remainingQuantityBase: updated.remainingQuantityBase,
              updatedAt: now,
            },
          });
        }

        // Update stock level cache
        const currentLevel = await tx.stockLevel.findUnique({
          where: {
            storeId_storeVariantId: {
              storeId,
              storeVariantId: input.storeVariantId,
            },
          },
        });

        let runningBalance = currentLevel?.quantityBase ?? ZERO;

        // Record movements for each allocation
        const movementResults = [];
        for (const allocation of depletion.allocations) {
          runningBalance -= allocation.quantityBase;

          const mov = await tx.stockMovement.create({
            data: {
              storeId,
              storeVariantId: input.storeVariantId,
              storeProductId: variant.storeProductId,
              batchId: allocation.batchId,
              type: "sale",
              quantityBase: -allocation.quantityBase,
              costPriceMinor: allocation.costPriceMinor,
              balanceAfterBase: runningBalance,
              negative: allocation.isNegative,
              saleLineId: input.saleLineId ?? null,
              opId: input.opId ?? null,
              createdAt: now,
            },
          });
          movementResults.push(mov);
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
          duplicate: false,
          allocations: depletion.allocations.map((a) => ({
            batchId: a.batchId,
            quantityBase: Number(a.quantityBase),
            costPriceMinor: Number(a.costPriceMinor),
            isNegative: a.isNegative,
          })),
          shortfallBase: Number(depletion.shortfallBase),
          newBalance: Number(runningBalance),
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
            flavor: v.flavor,
            unitMode: v.storeProduct?.unit === "kg" ? "weight" : "piece",
            packQty: v.packQty,
            sellPricePiasters: Number(v.sellPricePiasters),
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
          take: options?.limit ?? 50,
          include: {
            storeVariant: {
              include: { storeProduct: true },
            },
            storeStockBatch: true,
          },
        });

        return movements.map((m) => ({
          id: m.id,
          variantId: m.storeVariantId,
          productName: m.storeVariant.storeProduct?.nameAr ?? "",
          type: m.type,
          quantityBase: Number(m.quantityBase),
          costPricePiasters: m.costPriceMinor ? Number(m.costPriceMinor) : null,
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
