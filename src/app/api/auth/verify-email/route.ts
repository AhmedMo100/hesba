import "server-only";
import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/server/modules/auth";
import { emailVerificationSchema } from "@/schemas/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = emailVerificationSchema.parse(body);

    const result = await verifyEmailToken(data.token);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
