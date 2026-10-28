import "server-only";
import { NextResponse } from "next/server";
import {
  requireSession,
  listUserPasskeys,
  revokeUserPasskey,
} from "@/server/modules/auth";
import { toSafeErrorResponse, AppError } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    const passkeys = await listUserPasskeys(context.user.id);

    return NextResponse.json({
      success: true,
      data: passkeys,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();
    const passkeyId = body?.passkeyId;

    if (!passkeyId) {
      throw AppError.badRequest("معرف مفتاح المرور مطلوب");
    }

    const result = await revokeUserPasskey(context.user.id, passkeyId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
