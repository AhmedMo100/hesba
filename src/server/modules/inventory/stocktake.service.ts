import "server-only";

/**
 * @file stocktake.service.ts
 * @description Physical inventory stocktaking (الجرد الفعلي): immutable snapshots,
 * session-level scopes (full, category, selected), tracking movements occurring during counting,
 * discrepancy classification (unrecorded sales, waste, unknown adjustments), and safe atomic reconciliation.
 *
 * @responsibility
 * 1. Create a stocktake session with an immutable expected-stock snapshot for all variants in scope.
 * 2. Calculate dynamic expected stock by combining the snapshot with legitimate movements occurring
 *    since session start (sales, purchases, returns, waste, manual adjustments).
 * 3. Track whether movements occurred after an item's count was recorded (concurrency cutoff).
 * 4. Update physical counts and discrepancy classifications without mutating stock yet.
 * 5. Reconcile and approve the session atomically via `withTenant`:
 *    - Shortages:
 *      * 'damaged_or_expired' -> creates `WasteRecord` + FEFO deduction with movement type 'waste'.
 *      * 'unrecorded_sales' -> FEFO deduction with movement type 'adjustment' (no fake invoices).
 *      * 'unknown_adjustment' -> FEFO deduction with movement type 'adjustment'.
 *    - Surpluses:
 *      * creates an adjustment batch + positive movement type 'adjustment'.
 *    - Rejection of stale / conflicting approvals and prevention of negative stock.
 * 6. Audit history of completed and cancelled stocktakes.
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import {
  lockStockLevelInTx,
  takeStockInTx,
  writeLevelInTx,
} from "./inventory.service";
import { totalFromUnitCost } from "@/domain/stock/batch-cost";
import { stockValuePiasters } from "@/domain/stock/stock-value";
import type {
  CreateStocktakeSessionInput,
  UpdateStocktakeCountsInput,
  ReconcileStocktakeInput,
  StocktakeSessionSummary,
  StocktakeSessionDetails,
  StocktakeItemDTO,
  StocktakeDiscrepancyKind,
} from "@/schemas/stocktake";

const ZERO = BigInt(0);

export class StocktakeService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Creates a new stocktake session. Only one active (in_progress) session is allowed per store.
   * Captures an immutable expected-stock snapshot for all matching variants.
   */
  async createSession(
    storeId: string,
    userId: string | null,
    input: CreateStocktakeSessionInput,
  ): Promise<StocktakeSessionSummary> {
    const now = new Date();

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Idempotency check via opId
        if (input.opId) {
          const existing = await tx.stocktakeSession.findFirst({
            where: { storeId, opId: input.opId },
          });
          if (existing) {
            return this.toSummary(existing);
          }
        }

        // 2. Prevent overlapping active sessions
        const active = await tx.stocktakeSession.findFirst({
          where: { storeId, status: "in_progress" },
        });
        if (active) {
          throw AppError.conflict(
            "فيه جلسة جرد شغالة حالياً، لازم تعتمدها أو تلغيها الأول قبل ما تبدأ جرد جديد",
          );
        }

        // 3. Find matching variants according to scope
        const storeProductWhere: Prisma.StoreProductWhereInput = {
          isActive: true,
          // Skip services and composite sandwiches from physical stocktaking
          kind: "standard",
        };

        if (input.scope === "category" && input.category) {
          storeProductWhere.category = input.category;
        }

        const variantWhere: Prisma.StoreVariantWhereInput = {
          storeId,
          isActive: true,
          storeProduct: storeProductWhere,
        };

        if (input.scope === "selected" && input.selectedVariantIds?.length) {
          variantWhere.id = { in: input.selectedVariantIds };
        }

        const variants = await tx.storeVariant.findMany({
          where: variantWhere,
          include: {
            storeProduct: true,
            stockLevels: { where: { storeId } },
          },
          orderBy: [
            { storeProduct: { category: "asc" } },
            { storeProduct: { nameAr: "asc" } },
          ],
        });

        if (variants.length === 0) {
          throw AppError.badRequest(
            "مفيش أصناف بضاعة مطابقة للنطاق المختار للجرد",
          );
        }

        // 4. Create the session
        const session = await tx.stocktakeSession.create({
          data: {
            storeId,
            status: "in_progress",
            scope: input.scope,
            category: input.category || null,
            notes: input.notes || null,
            opId: input.opId || null,
            totalProducts: variants.length,
            countedProducts: 0,
            shortageCount: 0,
            surplusCount: 0,
            matchedCount: 0,
            netCostPiasters: ZERO,
            costConfirmed: true,
            createdAt: now,
          },
        });

        // 5. Build and insert immutable snapshots for all variants in scope
        const itemsData = variants.map((v) => {
          const currentStock = v.stockLevels[0]?.quantityBase ?? ZERO;
          const buyPrice =
            v.buyPricePiasters && v.buyPricePiasters > ZERO
              ? v.buyPricePiasters
              : v.storeProduct?.buyPricePiasters &&
                  v.storeProduct.buyPricePiasters > ZERO
                ? v.storeProduct.buyPricePiasters
                : null;

          const unit = v.storeProduct?.unit || "piece";
          const snapshotCost =
            buyPrice !== null
              ? BigInt(
                  stockValuePiasters(
                    unit,
                    Number(currentStock),
                    Number(buyPrice),
                  ),
                )
              : null;

          return {
            storeId,
            sessionId: session.id,
            storeVariantId: v.id,
            storeProductId: v.storeProductId ?? v.id,
            snapshotQuantityBase: currentStock,
            snapshotCostPiasters: snapshotCost,
            expectedQuantityBase: currentStock,
            costConfirmed: buyPrice !== null,
            createdAt: now,
          };
        });

        await tx.stocktakeItem.createMany({
          data: itemsData,
        });

        return this.toSummary(session);
      },
      this.db,
    );
  }

  /**
   * Retrieves full details of a stocktake session, with live calculated expected stock
   * and movements that occurred since session start.
   */
  async getSessionDetails(
    storeId: string,
    userId: string | null,
    sessionId: string,
  ): Promise<StocktakeSessionDetails> {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const session = await tx.stocktakeSession.findFirst({
          where: { id: sessionId, storeId },
        });
        if (!session) {
          throw AppError.notFound("جلسة الجرد غير موجودة");
        }

        const items = await tx.stocktakeItem.findMany({
          where: { sessionId, storeId },
          include: {
            storeProduct: true,
            storeVariant: true,
          },
          orderBy: [
            { storeProduct: { category: "asc" } },
            { storeProduct: { nameAr: "asc" } },
          ],
        });

        // If session is still in_progress, dynamically calculate expected stock
        // by factoring in movements that occurred after session.createdAt
        const movementsMap = new Map<
          string,
          {
            sales: number;
            purchases: number;
            returns: number;
            waste: number;
            adjustments: number;
            netBase: number;
            postCountMovements: Map<string, number>;
          }
        >();

        if (session.status === "in_progress") {
          const variantIds = items.map((it) => it.storeVariantId);
          const movements = await tx.stockMovement.findMany({
            where: {
              storeId,
              storeVariantId: { in: variantIds },
              createdAt: { gte: session.createdAt },
            },
            select: {
              storeVariantId: true,
              type: true,
              quantityBase: true,
              createdAt: true,
            },
          });

          for (const m of movements) {
            let entry = movementsMap.get(m.storeVariantId);
            if (!entry) {
              entry = {
                sales: 0,
                purchases: 0,
                returns: 0,
                waste: 0,
                adjustments: 0,
                netBase: 0,
                postCountMovements: new Map(),
              };
              movementsMap.set(m.storeVariantId, entry);
            }
            const qty = Number(m.quantityBase);
            entry.netBase += qty;
            if (m.type === "sale") entry.sales += Math.abs(qty);
            else if (m.type === "purchase") entry.purchases += Math.abs(qty);
            else if (m.type === "return") entry.returns += Math.abs(qty);
            else if (m.type === "waste") entry.waste += Math.abs(qty);
            else if (m.type === "adjustment") entry.adjustments += qty;
          }
        }

        let shortageCount = 0;
        let surplusCount = 0;
        let matchedCount = 0;
        let netCostPiasters = 0;
        let costConfirmed = true;

        const itemDTOs: StocktakeItemDTO[] = items.map((it) => {
          const moveInfo = movementsMap.get(it.storeVariantId) ?? {
            sales: 0,
            purchases: 0,
            returns: 0,
            waste: 0,
            adjustments: 0,
            netBase: 0,
            postCountMovements: new Map(),
          };

          // Expected stock calculation (Rule 3 & 4):
          // Snapshot stock + all legitimate movements since snapshotAt
          const snapQty = Number(it.snapshotQuantityBase);
          const expectedQty =
            session.status === "in_progress"
              ? snapQty + moveInfo.netBase
              : Number(it.expectedQuantityBase ?? it.snapshotQuantityBase);

          let discrepancyQty: number | null = null;
          let discrepancyCost: number | null = null;
          let itemCostConfirmed = it.costConfirmed;

          // Did movements occur after this item's count was recorded?
          let movementsAfterCount = false;
          if (it.countedAt && session.status === "in_progress") {
            // Check if any movements were logged after countedAt
            if (moveInfo.netBase !== 0) {
              movementsAfterCount = true;
            }
          }

          if (it.countedQuantityBase !== null) {
            const countedQty = Number(it.countedQuantityBase);
            discrepancyQty = countedQty - expectedQty;

            const unit = it.storeProduct?.unit || "piece";
            const buyPrice =
              it.storeVariant?.buyPricePiasters &&
              it.storeVariant.buyPricePiasters > ZERO
                ? it.storeVariant.buyPricePiasters
                : it.storeProduct?.buyPricePiasters &&
                    it.storeProduct.buyPricePiasters > ZERO
                  ? it.storeProduct.buyPricePiasters
                  : null;

            if (buyPrice !== null) {
              discrepancyCost = stockValuePiasters(
                unit,
                Math.abs(discrepancyQty),
                Number(buyPrice),
              );
              if (discrepancyQty < 0) {
                discrepancyCost = -discrepancyCost;
              }
              netCostPiasters += discrepancyCost;
            } else {
              itemCostConfirmed = false;
              costConfirmed = false;
            }

            if (discrepancyQty < 0) shortageCount += 1;
            else if (discrepancyQty > 0) surplusCount += 1;
            else matchedCount += 1;
          }

          return {
            id: it.id,
            storeVariantId: it.storeVariantId,
            storeProductId: it.storeProductId,
            productName: it.storeProduct?.nameAr || "صنف بدون اسم",
            category: it.storeProduct?.category || "متفرقات",
            unit: it.storeProduct?.unit || "piece",
            barcode: it.storeVariant?.barcode || null,
            snapshotQuantityBase: snapQty,
            snapshotCostPiasters: it.snapshotCostPiasters
              ? Number(it.snapshotCostPiasters)
              : null,
            countedQuantityBase:
              it.countedQuantityBase !== null
                ? Number(it.countedQuantityBase)
                : null,
            countedAt: it.countedAt ? it.countedAt.toISOString() : null,
            expectedQuantityBase: expectedQty,
            discrepancyQuantityBase: discrepancyQty,
            discrepancyCostPiasters: discrepancyCost,
            costConfirmed: itemCostConfirmed,
            classification:
              it.classification as StocktakeDiscrepancyKind | null,
            notes: it.notes,
            movementsAfterCount,
            movementsSinceSnapshot: {
              sales: moveInfo.sales,
              purchases: moveInfo.purchases,
              returns: moveInfo.returns,
              waste: moveInfo.waste,
              adjustments: moveInfo.adjustments,
            },
          };
        });

        const summary = this.toSummary(session);
        if (session.status === "in_progress") {
          summary.shortageCount = shortageCount;
          summary.surplusCount = surplusCount;
          summary.matchedCount = matchedCount;
          summary.netCostPiasters = netCostPiasters;
          summary.costConfirmed = costConfirmed;
        }

        return {
          ...summary,
          items: itemDTOs,
        };
      },
      this.db,
    );
  }

  /**
   * Updates physical counted quantities and classifications for items in an active session.
   */
  async updateCounts(
    storeId: string,
    userId: string | null,
    sessionId: string,
    input: UpdateStocktakeCountsInput,
  ): Promise<{ updatedCount: number }> {
    const now = new Date();

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const session = await tx.stocktakeSession.findFirst({
          where: { id: sessionId, storeId },
        });
        if (!session) {
          throw AppError.notFound("جلسة الجرد غير موجودة");
        }
        if (session.status !== "in_progress") {
          throw AppError.badRequest(
            "لا يمكن تعديل عدّاد جلسة جرد معتمدة أو ملغاة",
          );
        }

        for (const it of input.items) {
          await tx.stocktakeItem.updateMany({
            where: {
              sessionId,
              storeId,
              storeVariantId: it.storeVariantId,
            },
            data: {
              countedQuantityBase: BigInt(it.countedQuantityBase),
              countedAt: now,
              classification: it.classification || null,
              notes: it.notes || null,
            },
          });
        }

        // Update countedProducts count on session
        const countedTotal = await tx.stocktakeItem.count({
          where: {
            sessionId,
            storeId,
            countedQuantityBase: { not: null },
          },
        });

        await tx.stocktakeSession.update({
          where: { id: sessionId },
          data: {
            countedProducts: countedTotal,
            updatedAt: now,
          },
        });

        return { updatedCount: input.items.length };
      },
      this.db,
    );
  }

  /**
   * Approves and reconciles the stocktake session atomically:
   * - Locks all variant stock levels
   * - Computes latest legitimate movements and exact discrepancy
   * - Creates WasteRecords for damaged/expired shortages
   * - Creates FEFO deduction movements for shortages
   * - Creates adjustment batches and positive movements for surpluses
   * - Marks session as reconciled and prevents duplicate runs
   */
  async reconcileSession(
    storeId: string,
    userId: string | null,
    sessionId: string,
    input: ReconcileStocktakeInput = {},
  ): Promise<StocktakeSessionSummary> {
    const now = new Date();

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        // 1. Lock the session row to prevent race conditions or duplicate approval
        const session = await tx.stocktakeSession.findFirst({
          where: { id: sessionId, storeId },
        });
        if (!session) {
          throw AppError.notFound("جلسة الجرد غير موجودة");
        }
        if (session.status === "reconciled") {
          // Idempotent return if already reconciled
          return this.toSummary(session);
        }
        if (session.status === "cancelled") {
          throw AppError.badRequest("جلسة الجرد ملغاة ولا يمكن اعتمادها");
        }

        // 2. Fetch all items in the session
        const items = await tx.stocktakeItem.findMany({
          where: { sessionId, storeId },
          include: {
            storeVariant: true,
            storeProduct: true,
          },
        });

        // Check if all items have been counted
        const uncounted = items.filter((it) => it.countedQuantityBase === null);
        if (uncounted.length > 0) {
          throw AppError.badRequest(
            `لسه فيه ${uncounted.length} صنف ماتعدش. لازم تعد كل الأصناف قبل الاعتماد النهائي`,
          );
        }

        let shortageCount = 0;
        let surplusCount = 0;
        let matchedCount = 0;
        let netCostPiasters = ZERO;
        let allCostsConfirmed = true;

        // 3. Process each item with strict stock locking and FEFO integrity
        for (const item of items) {
          const variant = item.storeVariant;
          const product = item.storeProduct;
          if (!variant || !product) continue;

          // Lock variant's current stock level (ADR-0019)
          const currentStock = await lockStockLevelInTx(
            tx,
            storeId,
            variant.id,
          );

          // Get movements that occurred since session.createdAt
          const movements = await tx.stockMovement.findMany({
            where: {
              storeId,
              storeVariantId: variant.id,
              createdAt: { gte: session.createdAt },
            },
            select: {
              quantityBase: true,
              createdAt: true,
            },
          });

          // Net movements occurred between snapshot and now
          let netMovements = ZERO;
          for (const m of movements) {
            netMovements += m.quantityBase;
          }

          // Expected stock right now = snapshot + movements
          const expectedStock = item.snapshotQuantityBase + netMovements;
          const countedStock = item.countedQuantityBase ?? expectedStock;
          const discrepancy = countedStock - expectedStock;

          // Classification overrides from input if provided
          const override = input.itemClassifications?.[variant.id];
          const classification: StocktakeDiscrepancyKind =
            override?.classification ??
            item.classification ??
            (discrepancy < ZERO ? "unknown_adjustment" : "unknown_adjustment");
          const notes = override?.notes ?? item.notes;

          const unit = product.unit || "piece";
          const unitPrice =
            variant.buyPricePiasters && variant.buyPricePiasters > ZERO
              ? variant.buyPricePiasters
              : product.buyPricePiasters && product.buyPricePiasters > ZERO
                ? product.buyPricePiasters
                : null;

          let itemCost: bigint | null = null;
          if (unitPrice !== null) {
            const rawVal = stockValuePiasters(
              unit,
              Math.abs(Number(discrepancy)),
              Number(unitPrice),
            );
            itemCost = discrepancy < ZERO ? -BigInt(rawVal) : BigInt(rawVal);
            netCostPiasters += itemCost;
          } else {
            allCostsConfirmed = false;
          }

          if (discrepancy === ZERO) {
            matchedCount += 1;
            await tx.stocktakeItem.update({
              where: { id: item.id },
              data: {
                expectedQuantityBase: expectedStock,
                discrepancyQuantityBase: ZERO,
                discrepancyCostPiasters: ZERO,
                costConfirmed: unitPrice !== null,
                classification: null,
                updatedAt: now,
              },
            });
            continue;
          }

          if (discrepancy > ZERO) {
            // Surplus (زيادة): Add adjustment batch
            surplusCount += 1;
            const batch = await tx.storeStockBatch.create({
              data: {
                storeId,
                storeVariantId: variant.id,
                storeProductId: product.id,
                batchCode: `STK-${Date.now().toString(36).toUpperCase()}`,
                receivedQuantityBase: discrepancy,
                remainingQuantityBase: discrepancy,
                costPriceMinor: unitPrice,
                costTotalMinor: totalFromUnitCost(unitPrice, discrepancy, unit),
                receivedAt: now,
                paid: true,
              },
            });

            const newBalance = currentStock + discrepancy;
            await writeLevelInTx(tx, storeId, variant.id, newBalance, now);

            await tx.stockMovement.create({
              data: {
                storeId,
                storeVariantId: variant.id,
                storeProductId: product.id,
                batchId: batch.id,
                type: "adjustment",
                quantityBase: discrepancy,
                costPriceMinor: unitPrice,
                balanceAfterBase: newBalance,
                negative: false,
                opId: input.opId || null,
                createdAt: now,
              },
            });
          } else {
            // Shortage (عجز): Deduct via FEFO
            shortageCount += 1;
            const shortageQty = -discrepancy;

            // Prevent negative stock
            if (currentStock < shortageQty) {
              throw AppError.conflict(
                `عجز صنف (${product.nameAr}) أكبر من المخزون الحالي المتاح (${currentStock}) نتيجة سحب حدث أثناء الجرد. أعد عدّ الصنف للتأكيد.`,
              );
            }

            if (classification === "damaged_or_expired") {
              // 1. Create WasteRecord
              const waste = await tx.wasteRecord.create({
                data: {
                  storeId,
                  storeVariantId: variant.id,
                  quantityBase: shortageQty,
                  costMinor: ZERO,
                  reason: "missing",
                  note: notes || "تسوية جرد - بضاعة تالفة أو منتهية الصلاحية",
                  createdAt: now,
                },
              });

              // 2. Take stock FEFO with type "waste"
              const taken = await takeStockInTx(tx, storeId, {
                storeVariantId: variant.id,
                storeProductId: product.id,
                quantityBase: shortageQty,
                type: "waste",
                wasteId: waste.id,
                opId: input.opId || null,
                now,
              });

              if (taken.costPiasters !== null) {
                await tx.wasteRecord.update({
                  where: { id: waste.id },
                  data: { costMinor: taken.costPiasters },
                });
              }
            } else {
              // unrecorded_sales or unknown_adjustment:
              // Deduct stock via FEFO as adjustment (NEVER invent financial sales revenue)
              await takeStockInTx(tx, storeId, {
                storeVariantId: variant.id,
                storeProductId: product.id,
                quantityBase: shortageQty,
                type: "adjustment",
                opId: input.opId || null,
                now,
              });
            }
          }

          // Update item record with authoritative reconciled numbers
          await tx.stocktakeItem.update({
            where: { id: item.id },
            data: {
              expectedQuantityBase: expectedStock,
              discrepancyQuantityBase: discrepancy,
              discrepancyCostPiasters: itemCost,
              costConfirmed: unitPrice !== null,
              classification,
              notes: notes || null,
              updatedAt: now,
            },
          });
        }

        // 4. Finalize session
        const updatedSession = await tx.stocktakeSession.update({
          where: { id: sessionId },
          data: {
            status: "reconciled",
            reconciledAt: now,
            reconciledBy: userId || null,
            shortageCount,
            surplusCount,
            matchedCount,
            netCostPiasters,
            costConfirmed: allCostsConfirmed,
            notes: input.notes || session.notes,
            updatedAt: now,
          },
        });

        return this.toSummary(updatedSession);
      },
      this.db,
    );
  }

  /**
   * Cancels an active stocktake session.
   */
  async cancelSession(
    storeId: string,
    userId: string | null,
    sessionId: string,
  ): Promise<StocktakeSessionSummary> {
    const now = new Date();

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const session = await tx.stocktakeSession.findFirst({
          where: { id: sessionId, storeId },
        });
        if (!session) {
          throw AppError.notFound("جلسة الجرد غير موجودة");
        }
        if (session.status === "reconciled") {
          throw AppError.badRequest(
            "لا يمكن إلغاء جلسة جرد تم اعتمادها وتسويتها بالفعل",
          );
        }

        const updated = await tx.stocktakeSession.update({
          where: { id: sessionId },
          data: {
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
          },
        });

        return this.toSummary(updated);
      },
      this.db,
    );
  }

  /**
   * Lists historical stocktake sessions for the store.
   */
  async listSessions(
    storeId: string,
    userId: string | null,
    limit = 50,
  ): Promise<StocktakeSessionSummary[]> {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const sessions = await tx.stocktakeSession.findMany({
          where: { storeId },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        return sessions.map((s) => this.toSummary(s));
      },
      this.db,
    );
  }

  /**
   * Returns current active in_progress session, if any.
   */
  async getActiveSession(
    storeId: string,
    userId: string | null,
  ): Promise<StocktakeSessionSummary | null> {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const active = await tx.stocktakeSession.findFirst({
          where: { storeId, status: "in_progress" },
        });
        return active ? this.toSummary(active) : null;
      },
      this.db,
    );
  }

  private toSummary(
    session: Prisma.StocktakeSessionGetPayload<Record<string, never>>,
  ): StocktakeSessionSummary {
    return {
      id: session.id,
      status: session.status as StocktakeSessionSummary["status"],
      scope: session.scope as StocktakeSessionSummary["scope"],
      category: session.category,
      notes: session.notes,
      totalProducts: session.totalProducts,
      countedProducts: session.countedProducts,
      shortageCount: session.shortageCount,
      surplusCount: session.surplusCount,
      matchedCount: session.matchedCount,
      netCostPiasters: Number(session.netCostPiasters),
      costConfirmed: session.costConfirmed,
      createdAt: session.createdAt.toISOString(),
      reconciledAt: session.reconciledAt
        ? session.reconciledAt.toISOString()
        : null,
      reconciledBy: session.reconciledBy,
      cancelledAt: session.cancelledAt
        ? session.cancelledAt.toISOString()
        : null,
    };
  }
}
