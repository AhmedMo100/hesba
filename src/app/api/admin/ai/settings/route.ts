import "server-only";
import { NextResponse } from "next/server";
import { requirePlatformAdmin, updateAiSettings } from "@/server/modules/admin";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { aiSettingsPatchSchema } from "@/schemas/admin-ai";

export const dynamic = "force-dynamic";

/** POST /api/admin/ai/settings — change global AI switches / limits (audited). */
export async function POST(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    const patch = aiSettingsPatchSchema.parse(await readJsonBody(req));
    return NextResponse.json({
      settings: await updateAiSettings(context.user.id, patch),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
