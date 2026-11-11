import "server-only";
import { NextResponse } from "next/server";
import {
  registerUserWithPassword,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    // The service validates the body with its zod schema.
    const body = (await readJsonBody(req)) as Parameters<
      typeof registerUserWithPassword
    >[0];
    const result = await registerUserWithPassword(body);

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
