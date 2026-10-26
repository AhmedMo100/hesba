import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe: returns 200 without touching external dependencies (e.g. database).
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
