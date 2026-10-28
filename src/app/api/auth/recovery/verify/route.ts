import "server-only";
import { NextResponse } from "next/server";
import {
  verifyRecoveryToken,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = body?.token;

    if (!token || typeof token !== "string") {
      throw AppError.badRequest("رمز الاسترداد مطلوب");
    }

    const userAgent = req.headers.get("user-agent") || "جهاز مسترد";
    const result = await verifyRecoveryToken(token, userAgent);

    const response = NextResponse.json({
      success: true,
      data: {
        session: {
          ...result.session,
          user: result.user,
          store: result.store,
        },
      },
    });

    const cookieOpts = getSessionCookieOptions();
    response.cookies.set(cookieOpts.name, result.token, cookieOpts);

    return response;
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
