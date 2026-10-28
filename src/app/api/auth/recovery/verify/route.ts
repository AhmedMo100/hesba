import "server-only";
import { NextResponse } from "next/server";
import {
  validateRecoveryToken,
  verifyRecoveryToken,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token || typeof token !== "string") {
      throw AppError.badRequest("رمز الاسترداد مطلوب");
    }

    const result = await validateRecoveryToken(token);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = body?.token;

    if (!token || typeof token !== "string") {
      throw AppError.badRequest("رمز الاسترداد مطلوب");
    }

    // If client requested validate-only check
    if (body.validateOnly) {
      const result = await validateRecoveryToken(token);
      return NextResponse.json({
        success: true,
        data: result,
      });
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
