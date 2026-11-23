import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  getServiceRules,
  listServiceTransactions,
} from "@/server/modules/services";
import { toSafeErrorResponse } from "@/server/platform/error";
import { reportRangeQuerySchema } from "@/schemas/report";
import { addDaysToDateKey, cairoDayStartUtc } from "@/domain/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/services?from=YYYY-MM-DD&to=YYYY-MM-DD — the services recorded (newest first), the
 * period's commissions, the catalog and the shop's commission rules.
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
    const rules = await getServiceRules(context.store.id, context.user.id);
    return NextResponse.json({ ...list, rules });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
