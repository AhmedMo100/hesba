import "server-only";
import { NextResponse } from "next/server";
import { resetPasswordWithCode } from "@/server/modules/auth";
import { toSafeErrorResponse, readJsonBody } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    // The service validates the body with its zod schema.
    const body = (await readJsonBody(req)) as Parameters<
      typeof resetPasswordWithCode
    >[0];
    const result = await resetPasswordWithCode(body, clientIp);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
