import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { cancelDailySales } from "@/server/modules/daily-sales";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** DELETE /api/daily-sales/:id — cancels one of today's totals (kept on record, money back). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSession(req, {
      capability: "dailySalesTotals",
    });
    const { id } = await params;
    const entry = await cancelDailySales(context.store.id, context.user.id, id);
    return NextResponse.json({ entry });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
