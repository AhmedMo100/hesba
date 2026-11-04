import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

const createSaleSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  variantId: z.string().uuid().optional(),
  name: z.string().trim().optional(),
  quantityBase: z.number().int().positive().default(1),
  amountPiasters: z.number().int().min(0),
  label: z.string().optional(),
  isCarton: z.boolean().optional(),
  commissionPiasters: z.number().int().optional(),
  machineId: z.string().uuid().optional().nullable(),
  machineDeductPiasters: z.number().int().optional().nullable(),
  machineName: z.string().optional().nullable(),
  timestamp: z.number().optional(),
});

/**
 * GET /api/sales
 * Returns recent sales for the authenticated store under tenant isolation.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);

    const sales = await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        return tx.sale.findMany({
          where: { storeId: context.store.id },
          orderBy: { createdAt: "desc" },
          take: 60,
          include: {
            saleLines: {
              include: {
                storeProduct: true,
                storeVariant: {
                  include: {
                    storeProduct: true,
                  },
                },
              },
            },
          },
        });
      },
      prisma,
    );

    const formatted = sales.map((s) => {
      const line = s.saleLines[0];
      const prod = line?.storeVariant?.storeProduct || line?.storeProduct;
      return {
        id: s.id,
        productId:
          prod?.id || line?.storeProductId || line?.storeVariantId || s.id,
        name: prod?.nameAr || "بيعة",
        amountPiasters: Number(s.totalPiasters),
        quantity: line?.quantityBaseUnits || 1,
        category: prod?.category || "عام",
        unit: prod?.unit || "piece",
        timestamp: s.createdAt.getTime(),
      };
    });

    return NextResponse.json({ sales: formatted });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/sales
 * Records a new completed sale with sale lines under tenant isolation.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();
    const input = createSaleSchema.parse(body);

    const saleId = input.id || crypto.randomUUID();
    const opId = crypto.randomUUID();

    const created = await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        // Determine whether target is variant or product
        let targetVariantId: string | null = null;
        let targetProductId: string | null = null;

        if (input.variantId) {
          const varExists = await tx.storeVariant.findFirst({
            where: { id: input.variantId, storeId: context.store.id },
            select: { id: true },
          });
          if (varExists) {
            targetVariantId = varExists.id;
          }
        }

        if (!targetVariantId && input.productId) {
          // Check if productId is a storeVariant
          const varExists = await tx.storeVariant.findFirst({
            where: { id: input.productId, storeId: context.store.id },
            select: { id: true },
          });
          if (varExists) {
            targetVariantId = varExists.id;
          } else {
            const prodExists = await tx.storeProduct.findFirst({
              where: { id: input.productId, storeId: context.store.id },
              select: { id: true },
            });
            if (prodExists) {
              targetProductId = prodExists.id;
            }
          }
        }

        // If neither exists, fallback to any default product or find first variant
        if (!targetVariantId && !targetProductId) {
          const anyVar = await tx.storeVariant.findFirst({
            where: { storeId: context.store.id },
            select: { id: true },
          });
          if (anyVar) {
            targetVariantId = anyVar.id;
          }
        }

        const newSale = await tx.sale.create({
          data: {
            id: saleId,
            storeId: context.store.id,
            paymentMethod: "cash",
            totalPiasters: BigInt(input.amountPiasters),
            opId,
            createdAt: input.timestamp ? new Date(input.timestamp) : new Date(),
            saleLines: {
              create: {
                storeId: context.store.id,
                storeVariantId: targetVariantId,
                storeProductId: targetVariantId ? null : targetProductId,
                quantityBaseUnits: input.quantityBase,
                unitPricePiasters: BigInt(input.amountPiasters),
                totalPiasters: BigInt(input.amountPiasters),
              },
            },
          },
        });

        return newSale;
      },
      prisma,
    );

    return NextResponse.json({ success: true, data: { id: created.id } });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/sales?id=<saleId>
 * Reverts/deletes a sale record from the store's database on Undo.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      throw AppError.badRequest("معرّف البيعة مطلوب");
    }

    await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        await tx.saleLine.deleteMany({
          where: { storeId: context.store.id, saleId: id },
        });
        await tx.sale.deleteMany({
          where: { storeId: context.store.id, id },
        });
      },
      prisma,
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
