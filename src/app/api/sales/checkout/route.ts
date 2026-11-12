import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { checkoutSale } from "@/server/modules/sales";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { checkoutSchema } from "@/schemas/sale";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/checkout — a cart sold as ONE invoice: server pricing, discount, payment
 * method, stock (FEFO) and, for a credit sale, the receivable — atomic and idempotent by
 * `opId` (QA-31, ADR-0027).
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = checkoutSchema.parse(await readJsonBody(req));
    const invoice = await checkoutSale(
      context.store.id,
      context.user.id,
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
