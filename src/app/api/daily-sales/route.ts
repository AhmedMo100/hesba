import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { listDailySales, recordDailySales } from "@/server/modules/daily-sales";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { dailySalesInputSchema } from "@/schemas/daily-sales";
import { reportRangeQuerySchema } from "@/schemas/report";
import { toCairoDateString } from "@/domain/time";

export const dynamic = "force-dynamic";

/** GET /api/daily-sales?from=YYYY-MM-DD&to=YYYY-MM-DD — the totals recorded (default: today). */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const url = new URL(req.url);
    const today = toCairoDateString(new Date());
    const { from, to } = reportRangeQuerySchema.parse({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    const result = await listDailySales(context.store.id, context.user.id, {
      from: from ?? to ?? today,
      to: to ?? from ?? today,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/daily-sales — إدارة المحل records the day's sales total (ADR-0033): cash to the drawer,
 * each wallet part to its machine's balance, atomically and once per `opId`. Refused in الكاشير
 * الذكي, where every sale is recorded on its own.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req, {
      capability: "dailySalesTotals",
    });
    const input = dailySalesInputSchema.parse(await readJsonBody(req));
    const { entry, duplicate } = await recordDailySales(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ entry }, { status: duplicate ? 200 : 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
