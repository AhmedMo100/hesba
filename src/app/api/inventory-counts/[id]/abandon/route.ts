import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { abandonInventoryCount } from "@/server/modules/inventory";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** POST /api/inventory-counts/:id/abandon — closes an open count; nothing is applied. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSession(req);
    const id = z
      .string()
      .uuid("الجرد غير صحيح")
      .parse((await params).id);
    const count = await abandonInventoryCount(
      context.store.id,
      context.user.id,
      id,
    );
    return NextResponse.json({ count });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
