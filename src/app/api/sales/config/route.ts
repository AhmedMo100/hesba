import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  getSalesViewConfig,
  saveSalesViewConfig,
} from "@/server/modules/sales";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { salesViewConfigUpdateSchema } from "@/schemas/sales-config";

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
 * POST /api/sales/config `{ enabledServiceIds?, enabledProductIds? }`
 * Partial update (QA-21): only the lists sent change; unknown fields, wrong types or an empty
 * body are a 400 and the saved config stays as it was. Returns the config as saved.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const config = await saveSalesViewConfig(
      context.store.id,
      context.user.id,
      salesViewConfigUpdateSchema.parse(await readJsonBody(req)),
    );
    return NextResponse.json({ success: true, config });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
