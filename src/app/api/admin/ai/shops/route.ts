import "server-only";
import { NextResponse } from "next/server";
import {
  listShopsForAdmin,
  requirePlatformAdmin,
} from "@/server/modules/admin";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** GET /api/admin/ai/shops?q= — shops with their scanner quota and usage (admin only). */
export async function GET(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    const q = (new URL(req.url).searchParams.get("q") ?? "")
      .trim()
      .slice(0, 80);
    return NextResponse.json({
      shops: await listShopsForAdmin(context.user.id, q),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
