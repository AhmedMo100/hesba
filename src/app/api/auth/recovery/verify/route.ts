import "server-only";
import { NextResponse } from "next/server";
import { verifyRecoveryToken } from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = body?.token;

    if (!token || typeof token !== "string") {
      throw AppError.badRequest("رمز الاسترداد مطلوب");
    }

    const result = await verifyRecoveryToken(token);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
