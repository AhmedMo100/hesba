import "server-only";

/**
 * @file usage.ts
 * @description Records one AI request (or a refusal) in `ai_usage_events` for the admin's
 * monitoring. Never stores the question, the answer or any image. Recording is best-effort:
 * a failure here is logged and never changes the user's result.
 */
import type { PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { logger } from "@/server/platform/logger";
import type { AiFeature } from "./ai-gate";

export interface AiUsageInput {
  feature: AiFeature;
  provider: string;
  model?: string | null;
  requestId: string;
  status: "succeeded" | "failed" | "rejected";
  errorCategory?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  imageCount?: number;
  estimatedCostMicros?: bigint;
  latencyMs?: number | null;
}

export async function recordAiUsage(
  prisma: PrismaClient,
  storeId: string,
  e: AiUsageInput,
): Promise<void> {
  try {
    await withTenant(
      storeId,
      null,
      (tx) =>
        tx.aiUsageEvent.create({
          data: {
            storeId,
            feature: e.feature,
            provider: e.provider,
            model: e.model ?? null,
            requestId: e.requestId,
            status: e.status,
            errorCategory: e.errorCategory ?? null,
            inputTokens: e.inputTokens ?? null,
            outputTokens: e.outputTokens ?? null,
            imageCount: e.imageCount ?? 0,
            estimatedCostMicros: e.estimatedCostMicros ?? BigInt(0),
            latencyMs: e.latencyMs ?? null,
          },
        }),
      prisma,
    );
  } catch (err: unknown) {
    logger.error(
      { err, feature: e.feature },
      "Failed to record AI usage event",
    );
  }
}
