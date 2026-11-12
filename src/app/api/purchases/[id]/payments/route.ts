import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { payPurchase } from "@/server/modules/purchases";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { purchasePaymentSchema } from "@/schemas/purchase";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/purchases/:id/payments — pay (part of) one supplier invoice (QA-30). */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const input = purchasePaymentSchema.parse(await readJsonBody(req));
    const purchase = await payPurchase(
      context.store.id,
      context.user.id,
      id,
      input,
    );
    return NextResponse.json(
      { purchase },
      { status: purchase.duplicate ? 200 : 201 },
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
