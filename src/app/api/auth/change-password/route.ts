import "server-only";
import { NextResponse } from "next/server";
import { requireSession, changeOwnPassword } from "@/server/modules/auth";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/change-password — the signed-in account changes ITS OWN password.
 * Body: `{ currentPassword, newPassword }` (strict). There is no way to name another user here:
 * the account is always the session's. The one route an account holding a temporary password
 * may use (`allowPasswordChange`); it also works for a shop whose subscription is over.
 *
 * 200 `{ revokedSessions }` · 400 wrong current / weak new password · 401 no session · 429.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req, {
      allowInactive: true,
      allowPasswordChange: true,
    });
    const body = (await readJsonBody(req)) as Parameters<
      typeof changeOwnPassword
    >[1];
    const result = await changeOwnPassword(context, body);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
