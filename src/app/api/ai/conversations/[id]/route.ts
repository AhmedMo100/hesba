import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/modules/auth";
import { prisma } from "@/server/infra/db/client";
import { AIConversationService } from "@/server/modules/ai";
import { toSafeErrorResponse } from "@/server/platform/error";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations/[id]
 * Retrieves the message history for a specific daily conversation, strictly verifying store ownership.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await requireSession(req);
    const { id } = await params;

    const convService = new AIConversationService(prisma);
    const details = await convService.getConversationDetails(
      context.store.id,
      id,
    );

    return NextResponse.json({
      conversation: {
        id: details.id,
        day: details.day.toISOString().slice(0, 10),
        title: details.title,
        created_at: details.createdAt.toISOString(),
        updated_at: details.updatedAt.toISOString(),
        messages: details.messages.map((m) => ({
          id: m.id,
          role: m.role,
          body_text: m.bodyText,
          sources: m.sources,
          created_at: m.createdAt.toISOString(),
        })),
      },
    });
  } catch (err: unknown) {
    return toSafeErrorResponse(err);
  }
}
