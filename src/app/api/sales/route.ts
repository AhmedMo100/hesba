import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  listRecentSales,
  recordSale,
  deleteSale,
} from "@/server/modules/sales";
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
    const input = createSaleSchema.parse(await readJsonBody(req));
    const recorded = await recordSale(context.store.id, context.user.id, input);
    return NextResponse.json({ success: true, data: recorded });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/**
 * DELETE /api/sales?id=<saleId>
 * Reverts/deletes a sale record from the store's database on Undo.
 */
export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const id = new URL(req.url).searchParams.get("id");

    if (!id) {
      throw AppError.badRequest("معرّف البيعة مطلوب");
    }

    await deleteSale(context.store.id, context.user.id, id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
