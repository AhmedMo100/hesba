import "server-only";
import { NextResponse } from "next/server";
import { requestAccountRecovery } from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = body?.email;

    if (!email || typeof email !== "string") {
      throw AppError.badRequest("البريد الإلكتروني مطلوب");
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    const result = await requestAccountRecovery(email, clientIp);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
