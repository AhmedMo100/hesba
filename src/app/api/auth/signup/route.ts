import "server-only";
import { NextResponse } from "next/server";
import {
  signupUserAndStore,
  getSessionCookieOptions,
} from "@/server/modules/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await signupUserAndStore(body);

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
