import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { voidSale } from "@/server/modules/sales";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { voidSaleSchema } from "@/schemas/sale";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/void  `{ saleId, opId?, reason? }`
 * Undoes a recorded sale with a reversing void in one transaction (ADR-0022, QA-10): the sale
 * stays recorded and is marked void, and exactly what it took goes back to stock.
 * Returns `{ success, data: VoidedSale }`; a sale already void returns `alreadyVoided: true`.
 * 400 invalid input · 401 no session · 404 unknown sale · 409 conflicting operation.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = voidSaleSchema.parse(await readJsonBody(req));
    const voided = await voidSale(context.store.id, context.user.id, input);
    return NextResponse.json({ success: true, data: voided });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
