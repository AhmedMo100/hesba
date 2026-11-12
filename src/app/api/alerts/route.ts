import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getStoreAlerts } from "@/server/modules/alerts";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/alerts
 * Computes live out-of-stock, low-stock, expired, and near-expiry alerts,
 * and dynamically crafts smart bundle & discount suggestions for near-expiry items.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json(
      await getStoreAlerts(context.store.id, context.user.id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
