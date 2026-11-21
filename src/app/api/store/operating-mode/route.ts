import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/modules/auth";
import { setOperatingMode } from "@/server/modules/tenancy";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";
import { OPERATING_MODES } from "@/domain/operating-mode";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    operatingMode: z.enum(OPERATING_MODES, {
      message: "اختار إدارة المحل أو الكاشير الذكي",
    }),
  })
  .strict();

/**
 * PATCH /api/store/operating-mode — the owner switches the signed-in shop between إدارة المحل
 * and الكاشير الذكي (ADR-0033). The shop comes from the session only; no other field can be
 * sent (strict), and the subscription is never touched.
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
