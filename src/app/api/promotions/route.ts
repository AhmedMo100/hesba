import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export interface PublishedPromotionItem {
  productId: string;
  variantId: string;
  productName: string;
  quantityBase: number;
  unit: string;
  regularPricePiasters: number;
}

export interface PublishedPromotion {
  id: string;
  title: string;
  description?: string;
  type?: "bundle" | "single_discount";
  items: PublishedPromotionItem[];
  originalPricePiasters: number;
  promoPricePiasters: number;
  savingsPiasters: number;
  expiryDaysMin?: number;
  createdAt: number;
}

const promotionSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  type: z.enum(["bundle", "single_discount"]).default("bundle"),
  items: z.array(
    z.object({
      productId: z.string(),
      variantId: z.string(),
      productName: z.string(),
      quantityBase: z.number().positive(),
      unit: z.string().default("piece"),
      regularPricePiasters: z.number().int().min(0),
    }),
  ),
  originalPricePiasters: z.number().int().positive(),
  promoPricePiasters: z.number().int().positive(),
  savingsPiasters: z.number().int().min(0),
  expiryDaysMin: z.number().optional(),
});

/**
 * GET /api/promotions
 * Returns active published promotional offers for the current store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);

    const promotions = await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: context.store.id },
          select: { settings: true },
        });

        const settings = (store?.settings as Record<string, unknown>) || {};
        const promos = Array.isArray(settings.activePromotions)
          ? (settings.activePromotions as PublishedPromotion[])
          : [];
        return promos;
      },
      prisma,
    );

    return NextResponse.json({ promotions });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/promotions
 * Publishes an approved promotional bundle or discount offer into the store's active promotions.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();
    const input = promotionSchema.parse(body);

    const promotion: PublishedPromotion = {
      ...input,
      createdAt: Date.now(),
    };

    await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: context.store.id },
          select: { settings: true },
        });

        const settings = (store?.settings as Record<string, unknown>) || {};
        const currentPromos = Array.isArray(settings.activePromotions)
          ? (settings.activePromotions as PublishedPromotion[])
          : [];

        // Deduplicate by ID
        const filtered = currentPromos.filter((p) => p.id !== promotion.id);
        const updated = [promotion, ...filtered];

        await tx.store.update({
          where: { id: context.store.id },
          data: {
            settings: JSON.parse(
              JSON.stringify({
                ...settings,
                activePromotions: updated,
              }),
            ) as Prisma.InputJsonValue,
          },
        });
      },
      prisma,
    );

    return NextResponse.json({ success: true, promotion });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/promotions?id=<promoId>
 * Deactivates and removes a promotional offer.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      throw AppError.badRequest("معرّف العرض مطلوب");
    }

    await withTenant(
      context.store.id,
      context.user.id,
      async (tx) => {
        const store = await tx.store.findUnique({
          where: { id: context.store.id },
          select: { settings: true },
        });

        const settings = (store?.settings as Record<string, unknown>) || {};
        const currentPromos = Array.isArray(settings.activePromotions)
          ? (settings.activePromotions as PublishedPromotion[])
          : [];

        const updated = currentPromos.filter((p) => p.id !== id);

        await tx.store.update({
          where: { id: context.store.id },
          data: {
            settings: JSON.parse(
              JSON.stringify({
                ...settings,
                activePromotions: updated,
              }),
            ) as Prisma.InputJsonValue,
          },
        });
      },
      prisma,
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
