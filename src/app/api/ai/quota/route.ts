import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { AIService, assistantProviderInfo } from "@/server/modules/ai";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/quota
 * Returns the current day's AI message quota status for the authenticated store.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);

    const aiService = new AIService(prisma);
    const quota = await aiService.getQuota(context.store.id);

    return NextResponse.json({
      used: quota.used,
      remaining: quota.remaining,
      limit: quota.limit,
      resets_at: quota.resetsAt,
      day_key: quota.dayKey,
      // `grounded`: private mode — questions are answered on the server from the shop's data,
      // nothing is sent to an AI provider (ADR-0030).
      mode: assistantProviderInfo().mode,
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
