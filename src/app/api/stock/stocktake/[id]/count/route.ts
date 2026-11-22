import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { StocktakeService } from "@/server/modules/inventory";
import { updateStocktakeCountsSchema } from "@/schemas/stocktake";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/stock/stocktake/:id/count
 * Updates physical counts and classifications for items in an active session.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const body = await readJsonBody(req);
    const input = updateStocktakeCountsSchema.parse(body);

    const service = new StocktakeService(prisma);
    const result = await service.updateCounts(
      context.store.id,
      context.user.id,
      id,
      input,
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
