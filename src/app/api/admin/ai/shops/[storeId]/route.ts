import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, updateShopQuota } from "@/server/modules/admin";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { shopQuotaPatchSchema } from "@/schemas/admin-ai";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ storeId: string }> };

/** POST /api/admin/ai/shops/:storeId — a shop's scanner limits, switch, or a bonus grant (audited). */
export async function POST(req: Request, { params }: RouteParams) {
  try {
    const context = await requirePlatformAdmin(req);
    const storeId = z
      .string()
      .uuid("المحل غير صحيح")
      .parse((await params).storeId);
    const patch = shopQuotaPatchSchema.parse(await readJsonBody(req));
    return NextResponse.json({
      quota: await updateShopQuota(context.user.id, storeId, patch),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
