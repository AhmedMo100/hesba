import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

export async function GET() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["VERCEL_ENV"] === "production"
  ) {
    return NextResponse.json(
      { error: "Not allowed in production" },
      { status: 403 },
    );
  }

  const error = new Error(
    "Sentry staging verification test error for customer 01012345678",
  );
  const eventId = Sentry.captureException(error, {
    tags: {
      test: "sentry-verification-a11",
      env: "staging",
    },
  });

  const timestamp = new Date().toISOString();
  console.log(`[SENTRY_EVENT] ID=${eventId} TIMESTAMP=${timestamp}`);

  // Flush event to ensure it is sent over HTTPS to Sentry before termination
  await Sentry.flush(3000);

  // Debug route throws as required by Task 3
  throw error;
}
