import "server-only";
import { NextResponse } from "next/server";
import {
  completeAccountRecovery,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, credential, passkeyLabel } = body;

    if (!token || !credential) {
      throw AppError.badRequest("بيانات استرداد الحساب غير مكتملة");
    }

    const result = await completeAccountRecovery(
      token,
      credential,
      passkeyLabel,
    );

    const res = NextResponse.json({
      success: true,
      data: result,
    });

    const cookieOptions = getSessionCookieOptions();
    res.cookies.set({
      name: cookieOptions.name,
      value: result.token,
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
