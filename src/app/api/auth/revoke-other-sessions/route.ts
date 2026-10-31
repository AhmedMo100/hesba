import "server-only";
import { NextResponse } from "next/server";
import {
  requireSession,
  revokeOtherUserSessions,
  SESSION_COOKIE_NAME,
} from "@/server/modules/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const cookieHeader = req.headers.get("cookie");
    let rawToken = "";
    if (cookieHeader) {
      const match = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      if (match) {
        rawToken = match.substring(SESSION_COOKIE_NAME.length + 1);
      }
    }

    await revokeOtherUserSessions(context.user.id, rawToken);

    return NextResponse.json({
      success: true,
      data: { message: "تم تسجيل الخروج من الأجهزة الأخرى بنجاح" },
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
