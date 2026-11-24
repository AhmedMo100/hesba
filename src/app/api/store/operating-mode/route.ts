import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { setOperatingMode } from "@/server/modules/tenancy";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    // One package (ADR-0035): الكاشير الذكي only. A shop can no longer be switched to
    // إدارة المحل; 'pos' stays accepted (idempotent) for an older app.
    operatingMode: z.literal("pos", {
      message: "حِسبة بقت باقة واحدة: الكاشير الذكي",
    }),
  })
  .strict();

/**
 * PATCH /api/store/operating-mode — puts the signed-in shop on الكاشير الذكي (ADR-0033 /
 * ADR-0035). The shop comes from the session only; no other field can be sent (strict), and
 * the subscription is never touched.
 */
export async function PATCH(req: Request) {
  try {
    const context = await requireSession(req);
    const { operatingMode } = bodySchema.parse(await readJsonBody(req));
    const result = await setOperatingMode(
      context.store.id,
      context.user.id,
      operatingMode,
    );
    return NextResponse.json(result);
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
