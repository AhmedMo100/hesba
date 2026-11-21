import "server-only";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { reportExportTables } from "@/server/modules/reports";
import { toSafeErrorResponse } from "@/server/platform/error";
import {
  CSV_TYPE,
  XLSX_TYPE,
  fileResponse,
  toCsv,
  toXlsx,
} from "@/server/platform/export/spreadsheet";
import { REPORT_PERIODS, reportRangeQuerySchema } from "@/schemas/report";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  period: z.enum(REPORT_PERIODS, { message: "الفترة غير صحيحة" }),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
});

/**
 * GET /api/reports/export?period=…&from=…&to=…&format=xlsx|csv
 * The report of the period as a file: the summary, the expenses, the stock that came in, the
 * losses and the top products — built from the same services as `/api/reports/home`.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const url = new URL(req.url);
    const q = querySchema.parse({
      period: url.searchParams.get("period") ?? "today",
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      format: url.searchParams.get("format") ?? undefined,
    });
    reportRangeQuerySchema.parse({ from: q.from, to: q.to });
    const { tables, label, summary } = await reportExportTables(
      context.store.id,
      context.user.id,
      q.period,
      { customFrom: q.from, customTo: q.to },
    );
    const name = `تقرير حسبة ${
      label
        .replace(/[^\d\-→ ]/g, "")
        .replace(/ → /g, " الى ")
        .trim() || label
    }`;
    return q.format === "csv"
      ? fileResponse(toCsv(tables), CSV_TYPE, `${name}.csv`, summary)
      : fileResponse(toXlsx(tables), XLSX_TYPE, `${name}.xlsx`, summary);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
