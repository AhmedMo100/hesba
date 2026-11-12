import "server-only";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { servicePrisma } from "@/server/infra/db/client";
import { CommunitySuggestionsService } from "@/server/modules/catalog";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";
import { logger } from "@/server/platform/logger";
import { env } from "@/server/config/env";

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
      logger.warn("Unauthorized attempt to trigger catalog promotion cron");
      throw AppError.unauthorized("غير مصرح بالوصول لمهمة التعميم الدورية");
    }

    // Cross-store work runs ONLY as the least-privilege service role (ADR-0024, QA-34) —
    // never as the migrator, which no longer bypasses tenant isolation.
    if (!servicePrisma) {
      logger.error(
        "HESBA_SERVICE_DATABASE_URL is not configured; cron skipped",
      );
      throw AppError.serviceUnavailable("مهمة التعميم الدورية غير مفعّلة");
    }
    const [role] = await servicePrisma.$queryRaw<Array<{ role: string }>>`
      SELECT current_user::text AS role`;
    if (role?.role !== "hesba_service") {
      logger.error(
        "Catalog cron connection is not the hesba_service role; refused",
      );
      throw AppError.serviceUnavailable("مهمة التعميم الدورية غير مفعّلة");
    }
    const communityService = new CommunitySuggestionsService(servicePrisma);

    // Find all suggestable candidates not yet approved or hidden
    const candidates = await servicePrisma.catalogCandidate.findMany({
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
