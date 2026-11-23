import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  listServiceTransactions,
  listShopServices,
} from "@/server/modules/services";
import { toSafeErrorResponse } from "@/server/platform/error";
import { reportRangeQuerySchema } from "@/schemas/report";
import { addDaysToDateKey, cairoDayStartUtc } from "@/domain/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/services?from=YYYY-MM-DD&to=YYYY-MM-DD — the services recorded (newest first), the
 * period's commissions (services page + cashier), and the shop's services, each with its ONE
 * commission rule (ADR-0035).
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const url = new URL(req.url);
    const { from, to } = reportRangeQuerySchema.parse({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    const list = await listServiceTransactions(
      context.store.id,
      context.user.id,
      {
        from: from ? cairoDayStartUtc(from) : undefined,
        to: to ? cairoDayStartUtc(addDaysToDateKey(to, 1)) : undefined,
      },
    );
    const services = await listShopServices(context.store.id, context.user.id);
    return NextResponse.json({ ...list, services });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
