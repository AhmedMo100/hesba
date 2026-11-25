import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getMoneyOverview } from "@/server/modules/money";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** GET /api/money — «فلوس حِسبة»: every account's balance, the total, the latest movements. */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json(
      await getMoneyOverview(context.store.id, context.user.id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
