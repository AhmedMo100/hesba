import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { StocktakeService } from "@/server/modules/inventory";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/stock/stocktake/:id/cancel
 * Cancels an active stocktake session.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;

    const service = new StocktakeService(prisma);
    const session = await service.cancelSession(
      context.store.id,
      context.user.id,
      id,
    );

    return NextResponse.json({ session });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
