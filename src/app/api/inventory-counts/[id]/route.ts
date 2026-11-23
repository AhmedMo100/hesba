import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import {
  getInventoryCount,
  updateInventoryCount,
} from "@/server/modules/inventory";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { updateInventoryCountSchema } from "@/schemas/inventory-count";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid("الجرد غير صحيح");
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/inventory-counts/:id — the count with every line (expected, counted, difference). */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const context = await requireSession(req);
    const id = idSchema.parse((await params).id);
    const count = await getInventoryCount(
      context.store.id,
      context.user.id,
      id,
    );
    return NextResponse.json({ count });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/** PATCH /api/inventory-counts/:id — counted quantities and reasons (while it is open). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const context = await requireSession(req);
    const id = idSchema.parse((await params).id);
    const input = updateInventoryCountSchema.parse(await readJsonBody(req));
    const count = await updateInventoryCount(
      context.store.id,
      context.user.id,
      id,
      input,
    );
    return NextResponse.json({ count });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
