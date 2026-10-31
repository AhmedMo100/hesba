import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { InventoryService } from "@/server/modules/inventory";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

const addStockSchema = z.object({
  action: z.literal("add"),
  storeVariantId: z.string().uuid(),
  quantityBase: z
    .number()
    .int()
    .positive("الكمية يجب أن تكون رقماً صحيحاً موجباً"),
  costPricePiasters: z.number().int().min(0, "سعر التكلفة يجب ألا يقل عن صفر"),
  expiryDate: z.string().optional().nullable(),
  batchCode: z.string().trim().optional().nullable(),
  opId: z.string().uuid().optional(),
});

const wasteStockSchema = z.object({
  action: z.literal("waste"),
  storeVariantId: z.string().uuid(),
  quantityBase: z
    .number()
    .int()
    .positive("الكمية يجب أن تكون رقماً صحيحاً موجباً"),
  batchId: z.string().uuid().optional().nullable(),
  reason: z.string().trim().default("expired"),
  opId: z.string().uuid().optional(),
});

const stockActionSchema = z.discriminatedUnion("action", [
  addStockSchema,
  wasteStockSchema,
]);

/**
 * GET /api/stock
 * Returns current inventory levels and recent movements.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view"); // 'levels' | 'movements' | 'all'

    const inventoryService = new InventoryService(prisma);

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
          costPriceMinor: input.costPricePiasters,
          expiryDate: input.expiryDate,
          batchCode: input.batchCode,
          opId: input.opId,
        },
      );
      return NextResponse.json({ success: true, data: result });
    } else {
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
    }
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
