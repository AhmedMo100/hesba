import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { assertStoreOwner } from "@/server/modules/tenancy";
import { saveServiceRules } from "@/server/modules/services";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { serviceRulesSchema } from "@/schemas/money";

export const dynamic = "force-dynamic";

/** PUT /api/services/rules — the shop's commission rule per service (owner only; null removes). */
export async function PUT(req: Request) {
  try {
    const context = await requireSession(req);
    await assertStoreOwner(context.store.id, context.user.id);
    const input = serviceRulesSchema.parse(await readJsonBody(req));
    const rules = await saveServiceRules(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ rules });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
