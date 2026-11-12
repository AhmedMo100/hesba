import "server-only";
import { NextResponse } from "next/server";
import {
  loginWithPassword,
  getSessionCookieOptions,
  assertSameOriginWrite,
} from "@/server/modules/auth";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    assertSameOriginWrite(req); // QA-39
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    // The service validates the body with its zod schema.
    const body = (await readJsonBody(req)) as Parameters<
      typeof loginWithPassword
    >[0];
    const result = await loginWithPassword(body, clientIp);

    // The token travels only in the HttpOnly cookie, never in the body (QA-40).
    const { sessionToken: _token, ...data } = result;
    void _token;
    const res = NextResponse.json({ success: true, data });

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
