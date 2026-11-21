import "server-only";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { inventoryExportTables } from "@/server/modules/reports";
import { toSafeErrorResponse } from "@/server/platform/error";
import {
  CSV_TYPE,
  XLSX_TYPE,
  fileResponse,
  toCsv,
  toXlsx,
} from "@/server/platform/export/spreadsheet";
import { toCairoDateString } from "@/domain/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock/export?format=xlsx|csv — «الجرد» as a file: every item with its quantity and
 * unit, packs, buy and sell prices, its value at each, the nearest expiry and its state.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const format = z
      .enum(["xlsx", "csv"], { message: "الصيغة غير صحيحة" })
      .default("xlsx")
      .parse(new URL(req.url).searchParams.get("format") ?? undefined);
    const { tables, summary } = await inventoryExportTables(
      context.store.id,
      context.user.id,
    );
    const name = `جرد حسبة ${toCairoDateString(new Date())}`;
    return format === "csv"
      ? fileResponse(toCsv(tables), CSV_TYPE, `${name}.csv`, summary)
      : fileResponse(toXlsx(tables), XLSX_TYPE, `${name}.xlsx`, summary);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
