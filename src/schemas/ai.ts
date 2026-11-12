import { z } from "zod";

export const SendMessageSchema = z
  .object({
    body_text: z.string().trim().min(1).max(1000).optional(),
    message: z.string().trim().min(1).max(1000).optional(),
    client_message_id: z.string().trim().min(1).max(128).optional(),
    clientMessageId: z.string().trim().min(1).max(128).optional(),
    conversation_id: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
  })
  .refine((data) => Boolean((data.body_text ?? data.message)?.trim()), {
    message: "نص السؤال مطلوب",
    path: ["body_text"],
  })
  .transform((data) => ({
    body_text: (data.body_text ?? data.message)!.trim(),
    client_message_id: data.client_message_id ?? data.clientMessageId,
    conversation_id: data.conversation_id ?? data.conversationId,
  }));

export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const CitationSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
  publishedDate: z.string().optional(),
});

export const QuotaResponseSchema = z.object({
  used: z.number().int().min(0).max(5),
  remaining: z.number().int().min(0).max(5),
  limit: z.number().int().default(5),
  resets_at: z.string(),
  day_key: z.string(),
});

export const MessageItemSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  body_text: z.string(),
  sources: z.array(CitationSchema).optional(),
  created_at: z.string(),
});

export const ConversationSummarySchema = z.object({
  id: z.string().uuid(),
  day: z.string(),
  title: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const ConversationDetailSchema = ConversationSummarySchema.extend({
  messages: z.array(MessageItemSchema),
});

/**
 * The assistant's suggested questions (Prompt 2): only questions its read-only tools answer
 * from the shop's own data, in Egyptian Arabic. Shared by the screen and the private mode.
 */
export const AI_SUGGESTED_QUESTIONS = [
  "بعت كام النهارده؟",
  "إيه أكتر المنتجات اللي بتتباع عندي؟",
  "عندي منتجات قربت تخلص؟",
  "مين أكتر عميل عليه فلوس؟",
  "عليّا كام للموردين؟",
  "مصروفاتي الشهر ده كام؟",
  "كسبت كام الشهر ده؟",
  "قارن مبيعات الأسبوع ده بالأسبوع اللي فات.",
] as const;
