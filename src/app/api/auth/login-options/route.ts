import "server-only";
import { NextResponse } from "next/server";
import { generateAuthenticationOptionsForLogin } from "@/server/modules/auth";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    let identifier: string | undefined;
    try {
      const body = await req.json();
      identifier = body?.identifier;
    } catch {
      // Body may be empty if discoverable credentials
    }

    const options = await generateAuthenticationOptionsForLogin(identifier);

    return NextResponse.json({
      success: true,
      data: options,
    });
  } catch (err) {
    return toSafeErrorResponse(err);
  }
}
