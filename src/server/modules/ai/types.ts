import "server-only";

// Model/search contract types are owned by the vendor adapters in infra/ai and re-exported
// here so the AI module's public API is unchanged.
export type {
  Role,
  ChatMessage,
  ToolDefinition,
  ToolCall,
  SearchCitation,
  ProviderResponse,
} from "@/server/infra/ai";

export interface AIQuotaStatus {
  used: number;
  remaining: number;
  limit: number;
  resetsAt: string; // ISO 8601 UTC timestamp of next Cairo midnight
  dayKey: string; // YYYY-MM-DD in Cairo
}
