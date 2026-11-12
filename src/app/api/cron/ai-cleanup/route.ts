import "server-only";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/server/infra/db/client";
import { AIConversationService, ScannerService } from "@/server/modules/ai";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { env } from "@/server/config/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/ai-cleanup
 * Background cron endpoint to prune AI conversations older than 7 Cairo days.
 * Protected by HESBA_CRON_SECRET.
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const expectedSecret = env.HESBA_CRON_SECRET;

    if (!expectedSecret) {
      logger.error("HESBA_CRON_SECRET is not configured on the server");
      throw AppError.internal();
    }

    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const providedSecret = match?.[1] ?? "";

    const expectedBuf = Buffer.from(expectedSecret);
    const providedBuf = Buffer.from(providedSecret);

    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      logger.warn(
        "Unauthorized attempt to trigger AI conversation cleanup cron",
      );
      throw AppError.unauthorized("غير مصرح بالوصول لمهمة التنظيف الدورية");
    }

    const convService = new AIConversationService(prisma);
    const result = await convService.cleanupExpiredConversations();
    // Scanner retention (ADR-0030): stored scan results (product descriptions, no images) are
    // cleared after 7 days; old per-minute counters and expired leases are removed.
    const clearedScans = await new ScannerService(prisma).clearOldResults(7);
    await prisma.aiCapacityMinute.deleteMany({
      where: { minute: { lt: new Date(Date.now() - 24 * 3600_000) } },
    });
    await prisma.aiInflight.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    return NextResponse.json({
      ok: true,
      deleted_count: result.deletedCount,
      cleared_scan_results: clearedScans,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
