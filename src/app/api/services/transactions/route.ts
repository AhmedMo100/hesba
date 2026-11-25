import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { recordServiceTransaction } from "@/server/modules/services";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { serviceTransactionSchema } from "@/schemas/money";

export const dynamic = "force-dynamic";

/**
 * POST /api/services/transactions — a service the owner already performed on the provider's
 * app / machine (both modes). 201 new, 200 the same opId again.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = serviceTransactionSchema.parse(await readJsonBody(req));
    const { duplicate, ...transaction } = await recordServiceTransaction(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json(
      { transaction },
      { status: duplicate ? 200 : 201 },
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
