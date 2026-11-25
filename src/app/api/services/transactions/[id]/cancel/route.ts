import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { assertStoreOwner } from "@/server/modules/tenancy";
import { cancelServiceTransaction } from "@/server/modules/services";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** POST /api/services/transactions/:id/cancel — reverses it in Hesba's books (owner only). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSession(req);
    await assertStoreOwner(context.store.id, context.user.id);
    const id = z
      .string()
      .uuid("العملية غير صحيحة")
      .parse((await params).id);
    const transaction = await cancelServiceTransaction(
      context.store.id,
      context.user.id,
      id,
    );
    return NextResponse.json({ transaction });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
