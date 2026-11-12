import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { listRecentSales, recordSale } from "@/server/modules/sales";
import {
  AppError,
  readJsonBody,
  toSafeErrorResponse,
} from "@/server/platform/error";
import { createSaleSchema } from "@/schemas/sale";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales
 * Returns recent sales for the authenticated store under tenant isolation.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json(
      await listRecentSales(context.store.id, context.user.id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * POST /api/sales
 * Records a sale, its lines and its stock deduction in one transaction (ADR-0019) and returns
 * the sale as recorded: `{ success, data: RecordedSale }`. 409 when the stock is not enough.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    // A queued (offline) sale says which shop it was made in. If another shop is signed in
    // now, refuse it so the client keeps it for its own shop (ADR-0020). This header can only
    // cause a refusal: the shop that records a sale is always the session's.
    const queuedFor = req.headers.get("x-hesba-store-id");
    if (queuedFor && queuedFor !== context.store.id) {
      throw new AppError(
        "STORE_MISMATCH",
        "البيعة دي من محل تاني — هتتبعت لما تدخل بحساب المحل ده",
        403,
      );
    }
    const input = createSaleSchema.parse(await readJsonBody(req));
    const recorded = await recordSale(context.store.id, context.user.id, input);
    return NextResponse.json({ success: true, data: recorded });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

// There is no DELETE: sales are append-only. Undo is `POST /api/sales/void` (ADR-0022).
