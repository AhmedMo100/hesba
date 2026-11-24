import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { assertStoreOwner } from "@/server/modules/tenancy";
import { confirmInventoryCount } from "@/server/modules/inventory";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { confirmInventoryCountSchema } from "@/schemas/inventory-count";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventory-counts/:id/confirm — applies every counted difference by its reason, in
 * one transaction, once per opId. Owner only: it changes stock and the books.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSession(req);
    await assertStoreOwner(context.store.id, context.user.id);
    const id = z
      .string()
      .uuid("الجرد غير صحيح")
      .parse((await params).id);
    const { opId } = confirmInventoryCountSchema.parse(await readJsonBody(req));
    const count = await confirmInventoryCount(
      context.store.id,
      context.user.id,
      id,
      opId,
    );
    return NextResponse.json({ count });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
