import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import {
  getInventoryCountsOverview,
  startInventoryCount,
} from "@/server/modules/inventory";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { startInventoryCountSchema } from "@/schemas/inventory-count";

export const dynamic = "force-dynamic";

/** GET /api/inventory-counts — the stocktaking page: the open count, history, last count. */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json(
      await getInventoryCountsOverview(context.store.id, context.user.id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/** POST /api/inventory-counts — «اعمل جرد جديد» (idempotent by opId; one open count). */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = startInventoryCountSchema.parse(await readJsonBody(req));
    const count = await startInventoryCount(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ count }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
