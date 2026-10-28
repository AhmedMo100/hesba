import "server-only";
import { NextResponse } from "next/server";
import { requestMagicLink } from "@/server/modules/auth";
import { magicLinkRequestSchema } from "@/schemas/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = magicLinkRequestSchema.parse(body);
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    const result = await requestMagicLink(data.email, clientIp);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
