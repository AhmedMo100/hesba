import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getHomeReport } from "@/server/modules/reports";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { reportPeriodRefusal } from "@/domain/report-periods";
import { toCairoDateString } from "@/domain/time";
import {
  REPORT_PERIODS,
  homeReportSchema,
  reportRangeQuerySchema,
} from "@/schemas/report";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/home?period=…&from=…&to=…
 * The Home report of the signed-in store, from recorded data only (ADR-0021). The response
 * is validated against the shared `homeReportSchema` before it is sent.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const url = new URL(req.url);
    const period = z
      .enum(REPORT_PERIODS)
      .catch("today")
      .parse(url.searchParams.get("period") ?? "today");
    // A custom range's days are real dates (an impossible day is a 400, never a guess).
    const { from: customFrom, to: customTo } = reportRangeQuerySchema.parse({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    // Each package reads its own periods only (ADR-0036): months for إدارة المحل, days for
    // الكاشير الذكي. Another period is refused, never silently changed.
    const refusal = reportPeriodRefusal(
      context.store.operatingMode,
      period,
      customFrom,
      customTo,
      toCairoDateString(new Date()),
    );
    if (refusal) {
      throw AppError.modeForbidden(refusal, context.store.operatingMode);
    }
    const report = await getHomeReport(
      context.store.id,
      context.user.id,
      period,
      { customFrom, customTo },
    );
    return NextResponse.json(homeReportSchema.parse(report));
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
