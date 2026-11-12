import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  listPromotions,
  publishPromotion,
  removePromotion,
} from "@/server/modules/promotions";
import {
  AppError,
  toSafeErrorResponse,
  readJsonBody,
} from "@/server/platform/error";
import { promotionSchema } from "@/schemas/promotion";

export const dynamic = "force-dynamic";

/**
 * GET /api/promotions
 * Returns active published promotional offers for the current store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const promotions = await listPromotions(context.store.id, context.user.id);
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
    const input = promotionSchema.parse(await readJsonBody(req));
    const promotion = await publishPromotion(
      context.store.id,
      context.user.id,
      input,
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
    const id = new URL(req.url).searchParams.get("id");

    if (!id) {
      throw AppError.badRequest("معرّف العرض مطلوب");
    }

    await removePromotion(context.store.id, context.user.id, id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
