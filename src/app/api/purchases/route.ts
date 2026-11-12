import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { createPurchase, listPurchases } from "@/server/modules/purchases";
import {
  AppError,
  readJsonBody,
  toSafeErrorResponse,
} from "@/server/platform/error";
import { createPurchaseSchema } from "@/schemas/purchase";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/purchases[?supplierId=] — the shop's supplier purchases, newest first (QA-30). */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const supplierId = new URL(req.url).searchParams.get("supplierId");
    if (supplierId && !UUID.test(supplierId)) {
      throw AppError.badRequest("المورد غير صحيح");
    }
    const purchases = await listPurchases(context.store.id, context.user.id, {
      supplierId,
    });
    return NextResponse.json({ purchases });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/purchases — receive a supplier invoice: stock in, «عليك» up, optional payment
 * now, in one transaction. Idempotent by `opId` (QA-30, ADR-0027).
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = createPurchaseSchema.parse(await readJsonBody(req));
    const purchase = await createPurchase(
      context.store.id,
      context.user.id,
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
