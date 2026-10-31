import { z } from "zod";

export const SendMessageSchema = z.object({
  body_text: z
    .string({ message: "نص السؤال مطلوب" })
    .trim()
    .min(1, "نص السؤال مطلوب")
    .max(1000, "يجب ألا يتجاوز السؤال 1000 حرف"),
  client_message_id: z.string().trim().min(1).max(128).optional(),
});

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
