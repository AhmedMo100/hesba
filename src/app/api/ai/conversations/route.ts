import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { AIConversationService } from "@/server/modules/ai";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations
 * Lists the store's daily conversations within the 7-day retention period.
 */
export async function GET(req: Request) {
  try {
    const context = await requireSession(req);

    const convService = new AIConversationService(prisma);
    const conversations = await convService.listActiveConversations(
      context.store.id,
    );

    return NextResponse.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        day: c.day.toISOString().slice(0, 10),
        title: c.title,
        created_at: c.createdAt.toISOString(),
        updated_at: c.updatedAt.toISOString(),
      })),
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
