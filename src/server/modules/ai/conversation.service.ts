import "server-only";
import { PrismaClient, AiConversation, AiMessage } from "@prisma/client";
import {
  getCairoMidnightDate,
  getCairoConversationTitle,
  getRetentionCutoffDate,
} from "./cairo-date";
import { AI_CONVERSATION_RETENTION_DAYS } from "./constants";
import { withTenant } from "@/server/infra/db/tenant";
import { logger } from "@/server/platform/logger";
import { AppError } from "@/server/platform/error";

export interface ConversationWithMessages extends AiConversation {
  messages: AiMessage[];
}

export class AIConversationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Retrieves or atomically creates today's single daily conversation for the store.
   * Concurrency-safe via unique constraint on (store_id, day).
   */
  async getOrCreateTodayConversation(
    storeId: string,
    refDate: Date = new Date(),
  ): Promise<AiConversation> {
    const dayDate = getCairoMidnightDate(refDate);
    const title = getCairoConversationTitle(refDate);

    try {
      return await withTenant(
        storeId,
        null,
        async (tx) => {
          return await tx.aiConversation.upsert({
            where: {
              storeId_day: {
                storeId,
                day: dayDate,
              },
            },
            create: {
              storeId,
              day: dayDate,
              title,
            },
            update: {},
          });
        },
        this.prisma,
      );
    } catch (err: unknown) {
      logger.error(
        { err, storeId },
        "Failed to get or create today AI conversation",
      );
      throw err;
    }
  }

  /**
   * Lists conversations for the store within the 7-day retention period.
   * Older conversations are filtered out.
   */
  async listActiveConversations(
    storeId: string,
    refDate: Date = new Date(),
  ): Promise<AiConversation[]> {
    const cutoffDate = getRetentionCutoffDate(
      AI_CONVERSATION_RETENTION_DAYS,
      refDate,
    );

    return await withTenant(
      storeId,
      null,
      async (tx) => {
        return await tx.aiConversation.findMany({
          where: {
            storeId,
            day: {
              gte: cutoffDate,
            },
          },
          orderBy: {
            day: "desc",
          },
        });
      },
      this.prisma,
    );
  }

  /**
   * Retrieves a specific conversation and its message history, strictly verifying store ownership.
   */
  async getConversationDetails(
    storeId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages> {
    const conversation = await withTenant(
      storeId,
      null,
      async (tx) => {
        return await tx.aiConversation.findFirst({
          where: {
            id: conversationId,
            storeId,
          },
          include: {
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
        });
      },
      this.prisma,
    );

    if (!conversation) {
      throw AppError.notFound("المحادثة غير موجودة أو انتهت مدة الاحتفاظ بها");
    }

    return conversation;
  }

  /**
   * Background task: deletes conversations older than 7 Cairo days.
   * Cascades to their ai_messages, but leaves ai_usage and all business tables untouched.
   */
  async cleanupExpiredConversations(
    retentionDays = AI_CONVERSATION_RETENTION_DAYS,
    refDate: Date = new Date(),
  ): Promise<{ deletedCount: number }> {
    const cutoffDate = getRetentionCutoffDate(retentionDays, refDate);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.is_maintenance', 'true', true)`;
        const result = await tx.aiConversation.deleteMany({
          where: {
            day: {
              lt: cutoffDate,
            },
          },
        });

        logger.info(
          { deletedCount: result.count, cutoffDate: cutoffDate.toISOString() },
          "AI conversation retention cleanup completed successfully",
        );

        return { deletedCount: result.count };
      });
    } catch (err: unknown) {
      logger.error(
        { err, cutoffDate },
        "Failed to execute AI conversation retention cleanup",
      );
      throw err;
    }
  }
}
