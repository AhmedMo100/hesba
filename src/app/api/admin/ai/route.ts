import "server-only";
import { NextResponse } from "next/server";
import {
  getAiOverview,
  listAiAudit,
  requirePlatformAdmin,
} from "@/server/modules/admin";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** GET /api/admin/ai — platform AI usage, limits, budget, provider health and the audit log. */
export async function GET(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    const [overview, audit] = [
      await getAiOverview(context.user.id),
      await listAiAudit(context.user.id),
    ];
    return NextResponse.json({ ...overview, audit });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
