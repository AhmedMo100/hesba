import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getHomeReport } from "@/server/modules/reports";
import { toSafeErrorResponse } from "@/server/platform/error";
import { REPORT_PERIODS, homeReportSchema } from "@/schemas/report";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/home?period=today|yesterday|week|month|all
 * The Home report of the signed-in store, from recorded data only (ADR-0021). The response
 * is validated against the shared `homeReportSchema` before it is sent.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const period = z
      .enum(REPORT_PERIODS)
      .catch("today")
      .parse(new URL(req.url).searchParams.get("period") ?? "today");
    const report = await getHomeReport(
      context.store.id,
      context.user.id,
      period,
    );
    return NextResponse.json(homeReportSchema.parse(report));
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
