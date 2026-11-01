import "server-only";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { systemPrisma } from "@/server/infra/db/client";
import { CommunitySuggestionsService } from "@/server/modules/catalog/community-suggestions.service";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/catalog-promotion
 * Background cron endpoint to evaluate community candidates for discovery notifications (> 50%)
 * and global catalog promotion (> 70% and >= 7 days).
 * Protected by HESBA_CRON_SECRET.
 */
export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const expectedSecret = process.env.HESBA_CRON_SECRET || "";

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
      logger.warn("Unauthorized attempt to trigger catalog promotion cron");
      throw AppError.unauthorized("غير مصرح بالوصول لمهمة التعميم الدورية");
    }

    const communityService = new CommunitySuggestionsService(systemPrisma);

    // Find all suggestable candidates not yet approved or hidden
    const candidates = await systemPrisma.catalogCandidate.findMany({
      where: { status: "suggestable" },
      select: { id: true, nameAr: true },
    });

    const results = [];
    for (const c of candidates) {
      const evalResult = await communityService.evaluatePromotion(c.id);
      results.push({
        candidateId: c.id,
        nameAr: c.nameAr,
        ...evalResult,
      });
    }

    const promotedCount = results.filter((r) => r.promoted).length;

    return NextResponse.json({
      ok: true,
      evaluated_count: results.length,
      promoted_count: promotedCount,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
