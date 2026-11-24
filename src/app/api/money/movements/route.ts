import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { assertStoreOwner } from "@/server/modules/tenancy";
import { recordMoneyMovement } from "@/server/modules/money";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { moneyMovementSchema } from "@/schemas/money";

export const dynamic = "force-dynamic";

/**
 * POST /api/money/movements — an owner withdrawal / deposit or a transfer between the drawer
 * and the wallets. Owner only. 201 new, 200 the same opId again.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    await assertStoreOwner(context.store.id, context.user.id);
    const input = moneyMovementSchema.parse(await readJsonBody(req));
    const { duplicate, ...movement } = await recordMoneyMovement(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ movement }, { status: duplicate ? 200 : 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
