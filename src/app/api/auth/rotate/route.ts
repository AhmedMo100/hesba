import "server-only";
import { NextResponse } from "next/server";
import {
  rotateSession,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const cookieHeader = req.headers.get("cookie");
    let rawToken: string | undefined;

    if (cookieHeader) {
      const match = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
      if (match) {
        rawToken = match.substring(SESSION_COOKIE_NAME.length + 1);
      }
    }

    if (!rawToken) {
      const authHeader = req.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) {
        rawToken = authHeader.substring(7);
      }
    }

    if (!rawToken) {
      throw AppError.unauthorized();
    }

    const result = await rotateSession(rawToken);

    const res = NextResponse.json({
      success: true,
      data: {
        session: {
          idHash: result.session.idHash,
          userId: result.user.id,
          storeId: result.store.id,
          expiresAt: result.session.expiresAt.toISOString(),
        },
        token: result.rawToken,
      },
    });

    const cookieOptions = getSessionCookieOptions();
    res.cookies.set({
      name: cookieOptions.name,
      value: result.rawToken,
      httpOnly: cookieOptions.httpOnly,
      secure: cookieOptions.secure,
      sameSite: cookieOptions.sameSite,
      path: cookieOptions.path,
      maxAge: cookieOptions.maxAge,
    });

    return res;
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
