import "server-only";

export type Role = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface SearchCitation {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
}

export interface ProviderResponse {
  text: string;
  toolCalls?: ToolCall[];
  citations?: SearchCitation[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AIQuotaStatus {
  used: number;
  remaining: number;
  limit: number;
  resetsAt: string; // ISO 8601 UTC timestamp of next Cairo midnight
  dayKey: string; // YYYY-MM-DD in Cairo
}
