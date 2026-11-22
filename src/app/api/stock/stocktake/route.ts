import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { StocktakeService } from "@/server/modules/inventory";
import { createStocktakeSessionSchema } from "@/schemas/stocktake";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock/stocktake
 * Lists historical stocktake sessions and returns the active session if one is in progress.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const service = new StocktakeService(prisma);

    const overview = await service.getOverview(
      context.store.id,
      context.user.id,
    );

    return NextResponse.json(overview);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/stock/stocktake
 * Starts a new physical stocktake session with an immutable expected-stock snapshot.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await readJsonBody(req);
    const input = createStocktakeSessionSchema.parse(body);

    const service = new StocktakeService(prisma);
    const session = await service.createSession(
      context.store.id,
      context.user.id,
      input,
    );

    return NextResponse.json({ session }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
