import "server-only";
import { after, NextResponse } from "next/server";
import { requestPasswordResetCode } from "@/server/modules/auth";
import { readJsonBody, toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/forgot-password/request `{ email }`
 * Always the same 200 answer for a well-formed request, whether or not the email has an
 * account (QA-25). The code email is sent after the response (`after`), so its latency and
 * its failures are not visible to the caller. 400 malformed input · 429 rate-limited.
 */
export async function POST(req: Request) {
  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      undefined;

    const body = await readJsonBody(req);
    // The service validates the body with zod (`forgotPasswordRequestSchema`).
    const result = await requestPasswordResetCode(
      body as { email: string },
      clientIp,
      {
        deliver: (task) => {
          try {
            after(task); // after the response: its latency is not visible to the caller
          } catch {
            void task(); // outside a Next request (scripts, tests): still not awaited
          }
        },
      },
    );

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
