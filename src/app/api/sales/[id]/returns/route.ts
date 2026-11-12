import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { returnSale } from "@/server/modules/sales";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { saleReturnSchema } from "@/schemas/sale";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/sales/:id/returns — return some or all of a sale (QA-31, ADR-0027). */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const input = saleReturnSchema.parse(await readJsonBody(req));
    const invoice = await returnSale(
      context.store.id,
      context.user.id,
      id,
      input,
    );
    return NextResponse.json(
      { invoice },
      { status: invoice.duplicate ? 200 : 201 },
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
