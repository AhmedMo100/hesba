import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { getDrawer, recordDrawerCount } from "@/server/modules/drawer";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { drawerCountSchema } from "@/schemas/drawer";

export const dynamic = "force-dynamic";

/** GET /api/drawer — the last count and the cash expected in the drawer now (ADR-0031). */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const drawer = await getDrawer(context.store.id, context.user.id);
    return NextResponse.json({ drawer });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}

/** POST /api/drawer — the owner counted the drawer; idempotent by `opId`. */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const input = drawerCountSchema.parse(await readJsonBody(req));
    const drawer = await recordDrawerCount(
      context.store.id,
      context.user.id,
      input,
    );
    return NextResponse.json({ drawer }, { status: 201 });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
