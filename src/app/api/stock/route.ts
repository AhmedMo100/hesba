import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { InventoryService } from "@/server/modules/inventory";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { MAX_AMOUNT_PIASTERS, MAX_QUANTITY_BASE } from "@/domain/limits";

export const dynamic = "force-dynamic";

const addStockSchema = z.object({
  action: z.literal("add"),
  storeVariantId: z.string().uuid(),
  quantityBase: z
    .number()
    .int()
    .positive("الكمية يجب أن تكون رقماً صحيحاً موجباً")
    .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي"),
  /** What was paid for the whole quantity, in piasters (ADR-0021). */
  costTotalPiasters: z
    .number()
    .int()
    .min(0, "سعر التكلفة يجب ألا يقل عن صفر")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي")
    .optional(),
  /**
   * Deprecated name for the same value: the Add-Stock screen always sent the TOTAL here.
   * Kept so older clients keep working; `costTotalPiasters` wins when both are sent.
   */
  costPricePiasters: z
    .number()
    .int()
    .min(0, "سعر التكلفة يجب ألا يقل عن صفر")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي")
    .optional(),
  productionDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  batchCode: z.string().trim().optional().nullable(),
  supplierId: z.string().uuid().optional().nullable(),
  opId: z.string().uuid().optional(),
});

const wasteStockSchema = z.object({
  action: z.literal("waste"),
  storeVariantId: z.string().uuid(),
  quantityBase: z
    .number()
    .int()
    .positive("الكمية يجب أن تكون رقماً صحيحاً موجباً")
    .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي"),
  batchId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().default("expired"),
  opId: z.string().uuid().optional(),
});

const voidStockSchema = z.object({
  action: z.literal("void"),
  batchId: z.string().uuid(),
  reason: z.string().trim().optional(),
  opId: z.string().uuid().optional(),
});

const adjustStockSchema = z.object({
  action: z.literal("adjust"),
  storeVariantId: z.string().uuid(),
  mode: z.enum(["set", "delta"]).default("set"),
  targetQuantityBase: z
    .number()
    .int()
    .min(0, "الرصيد يجب ألا يقل عن صفر")
    .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي")
    .optional(),
  deltaQuantityBase: z
    .number()
    .int()
    .min(-MAX_QUANTITY_BASE, "الكمية كبيرة قوي")
    .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي")
    .optional(),
  reason: z.string().trim().optional(),
  opId: z.string().uuid().optional(),
});

const clearStockSchema = z.object({
  action: z.literal("clear"),
  storeVariantId: z.string().uuid(),
  reason: z.string().trim().optional(),
  removeFromView: z.boolean().optional(),
  opId: z.string().uuid().optional(),
});

const archiveStockSchema = z.object({
  action: z.literal("archive"),
  storeVariantId: z.string().uuid(),
  opId: z.string().uuid().optional(),
});

const stockActionSchema = z.discriminatedUnion("action", [
  addStockSchema,
  wasteStockSchema,
  voidStockSchema,
  adjustStockSchema,
  clearStockSchema,
  archiveStockSchema,
]);

/**
 * GET /api/stock
 * Returns current inventory levels and recent movements.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view"); // 'levels' | 'movements' | 'all' | 'reconcile'

    const inventoryService = new InventoryService(prisma);

    if (view === "reconcile") {
      // ADR-0021 (QA-05): level vs batches vs ledger, per variant of this store.
      const variantId = searchParams.get("variantId") ?? undefined;
      const reconciliation = await inventoryService.getStockReconciliation(
        context.store.id,
        context.user.id,
        {
          variantId:
            variantId &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              variantId,
            )
              ? variantId
              : undefined,
        },
      );
      return NextResponse.json({
        reconciliation,
        consistent: reconciliation.every((r) => r.consistent),
      });
    }

    if (view === "movements") {
      const movements = await inventoryService.getStockMovements(
        context.store.id,
        context.user.id,
      );
      return NextResponse.json({ movements });
    }

    const inventory = await inventoryService.getStoreInventory(
      context.store.id,
      context.user.id,
    );

    let movements = null;
    if (view === "all") {
      movements = await inventoryService.getStockMovements(
        context.store.id,
        context.user.id,
      );
    }

    return NextResponse.json({ inventory, movements });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/stock
 * Performs stock mutations (add batch, record waste) under tenant isolation.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();
    const input = stockActionSchema.parse(body);

    const inventoryService = new InventoryService(prisma);

    if (input.action === "add") {
      const result = await inventoryService.addStockBatch(
        context.store.id,
        context.user.id,
        {
          storeVariantId: input.storeVariantId,
          receivedQuantityBase: input.quantityBase,
          costTotalMinor:
            input.costTotalPiasters ?? input.costPricePiasters ?? null,
          productionDate: input.productionDate,
          expiryDate: input.expiryDate,
          batchCode: input.batchCode,
          supplierId: input.supplierId,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    } else if (input.action === "waste") {
      const result = await inventoryService.recordWaste(
        context.store.id,
        context.user.id,
        {
          storeVariantId: input.storeVariantId,
          quantityBase: input.quantityBase,
          batchId: input.batchId,
          reason: input.reason,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    } else if (input.action === "void") {
      const result = await inventoryService.voidStockBatch(
        context.store.id,
        context.user.id,
        {
          batchId: input.batchId,
          reason: input.reason,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    } else if (input.action === "adjust") {
      const result = await inventoryService.adjustStockQuantity(
        context.store.id,
        context.user.id,
        {
          storeVariantId: input.storeVariantId,
          mode: input.mode,
          targetQuantityBase: input.targetQuantityBase,
          deltaQuantityBase: input.deltaQuantityBase,
          reason: input.reason,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    } else if (input.action === "clear") {
      const result = await inventoryService.clearVariantStock(
        context.store.id,
        context.user.id,
        {
          storeVariantId: input.storeVariantId,
          reason: input.reason,
          removeFromView: input.removeFromView,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    } else {
      const result = await inventoryService.archiveVariantFromView(
        context.store.id,
        context.user.id,
        {
          storeVariantId: input.storeVariantId,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    }
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/stock?batchId=<uuid> OR /api/stock?variantId=<uuid>
 * Voids an added stock batch OR clears all stock for a variant under tenant isolation.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get("batchId");
    const variantId = searchParams.get("variantId");
    const removeFromView = searchParams.get("removeFromView") === "true";

    const inventoryService = new InventoryService(prisma);

    if (batchId) {
      const result = await inventoryService.voidStockBatch(
        context.store.id,
        context.user.id,
        { batchId },
      );
      return NextResponse.json({ success: true, data: result });
    } else if (variantId) {
      const result = await inventoryService.clearVariantStock(
        context.store.id,
        context.user.id,
        { storeVariantId: variantId, removeFromView },
      );
      return NextResponse.json({ success: true, data: result });
    } else {
      throw AppError.badRequest(
        "معرّف الإضافة (batchId) أو معرّف الصنف (variantId) مطلوب",
      );
    }
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
