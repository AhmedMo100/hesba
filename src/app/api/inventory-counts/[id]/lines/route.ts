import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { getInventoryCountLines } from "@/server/modules/inventory";
import { toSafeErrorResponse } from "@/server/platform/error";
import { countLinesQuerySchema } from "@/schemas/inventory-count";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid("الجرد غير صحيح");

/**
 * GET /api/inventory-counts/:id/lines — one page of the count's lines for the counting screen
 * (ADR-0039): `?barcode=` (the scanner), `?q=` (name search), `?variantId=`, `?status=pending |
 * counted | diff`, `?cursor=&limit=` (≤ 50). Each line carries the damage recorded on it lately
 * and its expired stock, as help only. Read only; this shop's count only.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSession(req);
    const id = idSchema.parse((await params).id);
    const url = new URL(req.url);
    const query = countLinesQuerySchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    return NextResponse.json(
      await getInventoryCountLines(
        context.store.id,
        context.user.id,
        id,
        query,
      ),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
