import "server-only";
import { PrismaClient } from "@prisma/client";
import { AI_DAILY_MESSAGE_LIMIT } from "./constants";
import {
  getCairoMidnightDate,
  getCairoDateString,
  getNextCairoMidnight,
} from "./cairo-date";
import { AIQuotaStatus } from "./types";
import { withTenant } from "@/server/infra/db/tenant";
import { logger } from "@/server/platform/logger";

export class AIQuotaService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Retrieves current daily usage and remaining quota for a given store.
   */
  async getQuotaStatus(
    storeId: string,
    refDate: Date = new Date(),
  ): Promise<AIQuotaStatus> {
    const dayDate = getCairoMidnightDate(refDate);
    const dayKey = getCairoDateString(refDate);

    const usageRecord = await withTenant(
      storeId,
      null,
      async (tx) => {
        return await tx.aiUsage.findUnique({
          where: {
            storeId_day: {
              storeId,
              day: dayDate,
            },
          },
        });
      },
      this.prisma,
    );

    const used = usageRecord ? usageRecord.count : 0;
    const remaining = Math.max(0, AI_DAILY_MESSAGE_LIMIT - used);
    const resetsAt = getNextCairoMidnight(refDate).toISOString();

    return {
      used,
      remaining,
      limit: AI_DAILY_MESSAGE_LIMIT,
      resetsAt,
      dayKey,
    };
  }

  /**
   * Atomically reserves 1 message credit for the store on the current Cairo day.
   * If usage is already >= 5, returns { success: false, remaining: 0 }.
   * Concurrency-safe in PostgreSQL via atomic INSERT ... ON CONFLICT DO UPDATE WHERE count < limit.
   */
  async reserveQuota(
    storeId: string,
    refDate: Date = new Date(),
  ): Promise<{ success: boolean; remaining: number }> {
    const dayDate = getCairoMidnightDate(refDate);
    const dayKey = getCairoDateString(refDate);

    try {
      const rows = await withTenant(
        storeId,
        null,
        async (tx) => {
          return await tx.$queryRaw<Array<{ count: number }>>`
            INSERT INTO "ai_usage" ("store_id", "day", "count", "updated_at")
            VALUES (${storeId}::uuid, ${dayDate}::date, 1, CURRENT_TIMESTAMP)
            ON CONFLICT ("store_id", "day")
            DO UPDATE SET 
              "count" = "ai_usage"."count" + 1,
              "updated_at" = CURRENT_TIMESTAMP
            WHERE "ai_usage"."count" < ${AI_DAILY_MESSAGE_LIMIT}
            RETURNING "count";
          `;
        },
        this.prisma,
      );

      if (!rows || rows.length === 0 || !rows[0]) {
        logger.info(
          { storeId, dayKey },
          "AI message daily quota limit exceeded",
        );
        return { success: false, remaining: 0 };
      }

      const count = rows[0].count;
      const remaining = Math.max(0, AI_DAILY_MESSAGE_LIMIT - count);
      return { success: true, remaining };
    } catch (err: unknown) {
      logger.error(
        { err, storeId, dayKey },
        "Error during atomic quota reservation",
      );
      throw err;
    }
  }

  /**
   * Safely rolls back 1 message credit in the event of an upstream AI provider failure.
   */
  async rollbackQuota(
    storeId: string,
    refDate: Date = new Date(),
  ): Promise<void> {
    const dayDate = getCairoMidnightDate(refDate);
    const dayKey = getCairoDateString(refDate);

    try {
      await withTenant(
        storeId,
        null,
        async (tx) => {
          await tx.$executeRaw`
            UPDATE "ai_usage"
            SET "count" = GREATEST(0, "count" - 1),
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "store_id" = ${storeId}::uuid AND "day" = ${dayDate}::date;
          `;
        },
        this.prisma,
      );
      logger.info(
        { storeId, dayKey },
        "AI message quota credit successfully restored after provider error",
      );
    } catch (err: unknown) {
      logger.error(
        { err, storeId, dayKey },
        "Failed to rollback AI quota credit",
      );
    }
  }
}
