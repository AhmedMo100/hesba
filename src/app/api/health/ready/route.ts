import { NextResponse } from "next/server";
import { prisma } from "@/server/infra/db/client";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2500;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

/**
 * Readiness probe: checks database connectivity with a strict 2.5s timeout.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    await withTimeout(
      prisma.$queryRaw`SELECT 1 as health_check`,
      DB_TIMEOUT_MS,
      `Database health check timed out after ${DB_TIMEOUT_MS}ms`,
    );

    return NextResponse.json(
      {
        status: "ready",
        database: "connected",
        timestamp,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Database connection failed";

    return NextResponse.json(
      {
        status: "not_ready",
        database: "disconnected",
        error: errorMessage,
        timestamp,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}
