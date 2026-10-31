import "server-only";
import { NextResponse } from "next/server";
import {
  loginWithPassword,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    const body = await req.json();
    const result = await loginWithPassword(body, clientIp);

    const res = NextResponse.json({
      success: true,
      data: result,
    });

    const cookieOptions = getSessionCookieOptions();
    res.cookies.set({
      name: cookieOptions.name,
      value: result.sessionToken,
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
