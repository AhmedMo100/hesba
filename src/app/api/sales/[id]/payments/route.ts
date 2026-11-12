import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { paySale } from "@/server/modules/sales";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { salePaymentSchema } from "@/schemas/sale";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/sales/:id/payments — the customer pays (part of) a credit invoice (QA-31). */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const input = salePaymentSchema.parse(await readJsonBody(req));
    const invoice = await paySale(context.store.id, context.user.id, id, input);
    return NextResponse.json(
      { invoice },
      { status: invoice.duplicate ? 200 : 201 },
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
