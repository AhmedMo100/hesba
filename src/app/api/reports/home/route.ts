import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getHomeReport } from "@/server/modules/reports";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { reportPeriodProblem } from "@/domain/report-periods";
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
    // An unknown period is a 400 (never silently read as today).
    const period = z
      .enum(REPORT_PERIODS)
      .parse(url.searchParams.get("period") ?? "today");
    // A custom range's days are real dates (an impossible day is a 400, never a guess).
    const { from: customFrom, to: customTo } = reportRangeQuerySchema.parse({
      from: url.searchParams.get("from") || undefined,
      to: url.searchParams.get("to") || undefined,
    });
    // Each package reads its own unit (ADR-0036): whole months for إدارة المحل, days for
    // الكاشير الذكي — a month, a range or a year, at most one year. A bad range is a 400; a
    // range of the other package's unit is a 403. Never silently changed.
    const problem = reportPeriodProblem(
      context.store.operatingMode,
      period,
      customFrom,
      customTo,
      toCairoDateString(new Date()),
    );
    if (problem?.kind === "invalid") throw AppError.badRequest(problem.message);
    if (problem) {
      throw AppError.modeForbidden(
        problem.message,
        context.store.operatingMode,
      );
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
