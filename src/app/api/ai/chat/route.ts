import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { AIService } from "@/server/modules/ai";
import { SendMessageSchema } from "@/schemas/ai";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/chat
 * Sends a question to the store's AI assistant, enforcing the strict 5 messages/day limit.
 */
export async function POST(req: Request) {
  try {
    const context = await requireSession(req);
    const body = await req.json();

    const parsed = SendMessageSchema.parse(body);

    const aiService = new AIService(prisma);
    const result = await aiService.processUserMessage({
      storeId: context.store.id,
      userId: context.user.id,
      bodyText: parsed.body_text,
      clientMessageId: parsed.client_message_id,
    });

    return NextResponse.json({
      conversation_id: result.conversationId,
      message_id: result.messageId,
      body_text: result.bodyText,
      sources: result.sources,
      quota: {
        used: result.quota.used,
        remaining: result.quota.remaining,
        limit: result.quota.limit,
        resets_at: result.quota.resetsAt,
        day_key: result.quota.dayKey,
      },
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
