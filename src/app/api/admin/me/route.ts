import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { isPlatformAdmin } from "@/server/modules/admin";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** GET /api/admin/me — whether the signed-in user is a Hesba platform admin. */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json({
      isAdmin: await isPlatformAdmin(context.user.id),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
