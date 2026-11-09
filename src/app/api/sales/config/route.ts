import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  getSalesViewConfig,
  saveSalesViewConfig,
} from "@/server/modules/sales";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales/config
 * Retrieves the customized sales view configuration for the active supermarket.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const config = await getSalesViewConfig(context.store.id, context.user.id);
    return NextResponse.json({ config });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/sales/config
 * Updates and persists the customized sales view configuration for the active supermarket in Postgres.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const config = await saveSalesViewConfig(
      context.store.id,
      context.user.id,
      await req.json(),
    );
    return NextResponse.json({ success: true, config });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
