/**
 * @file reports.ts
 * @description Browser client for the Home report (`GET /api/reports/home`, ADR-0021). The
 * JSON is parsed with the SAME zod schema the server validates against
 * (`@/schemas/report`), so Home never reads a field the server does not send (audit QA-06).
 *
 * @usedBy features/home (HomeView)
 */

import {
  homeReportSchema,
  type HomeReport,
  type ReportPeriod,
} from "@/schemas/report";

export type { HomeReport, ReportPeriod } from "@/schemas/report";

/** Parses a Home report response; throws when the shape does not match the contract. */
export function parseHomeReport(json: unknown): HomeReport {
  return homeReportSchema.parse(json);
}

export async function fetchHomeReport(
  period: ReportPeriod,
  signal?: AbortSignal,
): Promise<HomeReport> {
  const res = await fetch(
    `/api/reports/home?period=${encodeURIComponent(period)}`,
    { signal },
  );
  if (!res.ok) throw new Error(`report ${res.status}`);
  return parseHomeReport(await res.json());
}
