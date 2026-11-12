import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getSaleInvoice } from "@/server/modules/sales";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/sales/:id — one sale as an invoice: lines, returns, what is still owed (QA-31). */
export async function GET(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const invoice = await getSaleInvoice(context.store.id, context.user.id, id);
    return NextResponse.json({ invoice });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
