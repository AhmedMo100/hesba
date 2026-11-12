import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getPurchase } from "@/server/modules/purchases";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/purchases/:id */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const purchase = await getPurchase(context.store.id, context.user.id, id);
    return NextResponse.json({ purchase });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
