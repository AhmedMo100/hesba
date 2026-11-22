import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { StocktakeService } from "@/server/modules/inventory";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/stock/stocktake/:id
 * Fetches full session details, calculating dynamic expected stock and movements since snapshot.
 */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const service = new StocktakeService(prisma);
    const details = await service.getSessionDetails(
      context.store.id,
      context.user.id,
      id,
    );

    return NextResponse.json({ session: details });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
