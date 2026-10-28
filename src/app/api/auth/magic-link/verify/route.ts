import "server-only";
import { NextResponse } from "next/server";
import {
  verifyMagicLink,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { magicLinkVerifySchema } from "@/schemas/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = magicLinkVerifySchema.parse(body);
    const userAgent = req.headers.get("user-agent") || "متصفح الويب";

    const result = await verifyMagicLink(data.token, userAgent);

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
