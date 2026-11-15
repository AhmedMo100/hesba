import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { ScannerService } from "@/server/modules/ai";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/** GET /api/ai/scan/quota — this shop's scanner credits today / this month (Cairo). */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);
    return NextResponse.json(
      await new ScannerService(prisma).getQuota(context.store.id),
    );
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
