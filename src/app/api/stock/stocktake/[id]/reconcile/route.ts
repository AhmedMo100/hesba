import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { StocktakeService } from "@/server/modules/inventory";
import { reconcileStocktakeSchema } from "@/schemas/stocktake";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * POST /api/stock/stocktake/:id/reconcile
 * Approves and reconciles the session atomically with stock locking,
 * FEFO deductions, WasteRecords, and surplus adjustment batches.
 */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const body = (await readJsonBody(req)) ?? {};
    const input = reconcileStocktakeSchema.parse(body);

    const service = new StocktakeService(prisma);
    const session = await service.reconcileSession(
      context.store.id,
      context.user.id,
      id,
      input,
    );

    return NextResponse.json({ session });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
