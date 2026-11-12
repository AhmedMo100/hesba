import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { voidPurchase } from "@/server/modules/purchases";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { voidPurchaseSchema } from "@/schemas/purchase";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/** POST /api/purchases/:id/void — cancel a supplier invoice: stock out, debt reversed (QA-30). */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requireSession(req);
    const { id } = await params;
    const input = voidPurchaseSchema.parse(await readJsonBody(req));
    const purchase = await voidPurchase(
      context.store.id,
      context.user.id,
      id,
      input,
    );
    return NextResponse.json({ purchase });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
