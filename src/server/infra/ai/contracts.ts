import "server-only";

/**
 * @file contracts.ts
 * @description Vendor-neutral contracts for the AI assistant's external adapters: the chat
 * model (LLM) and the public web-search provider.
 *
 * The AI module (`src/server/modules/ai`) depends only on these interfaces. Concrete adapters
 * (Gemini, Brave, and their mocks) live next to this file, so a vendor can be replaced without
 * touching business code (AGENTS.md rule 9 — portability).
 *
 * @usedBy
 * - src/server/infra/ai/*.provider.ts
 * - src/server/modules/ai (re-exported from its types.ts)
 */

export type Role = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  role: Role;
  content: string;
  name?: string;
  toolCallId?: string;
  /** An assistant turn that asked for tools: the calls it made. */
  toolCalls?: ToolCall[];
  /**
   * The provider's own record of that assistant turn, replayed as-is on the follow-up call
   * (Gemini needs its `functionCall` parts, with their thought signatures, before the tool
   * results). Opaque outside the adapter that produced it.
   */
  providerParts?: unknown[];
}

/** JSON-schema description of a read-only business tool the model may call. */
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
  /** See {@link ChatMessage.providerParts}. */
  providerParts?: unknown[];
  citations?: SearchCitation[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AIProvider {
  readonly name: string;

  /**
   * Generates a completion from the model given the conversation history and available tools.
   *
   * `options.signal` is the reply's deadline (QA-29): an adapter stops waiting when it aborts
   * and throws a 503 `AppError`. A busy provider (429/5xx) is also a 503, never a 500.
   */
  generateChatCompletion(
    messages: ChatMessage[],
    systemInstruction: string,
    tools?: ToolDefinition[],
    options?: { signal?: AbortSignal },
  ): Promise<ProviderResponse>;
}

export interface SearchResult {
  query: string;
  citations: SearchCitation[];
  summary?: string;
  source: "live" | "cache" | "mock";
}

export interface SearchProvider {
  readonly name: string;

  /**
   * Searches external web data for commodity prices, inflation, fuel, or wholesale news.
   *
   * @remarks Security: private shop data (sales, stock, prices, names) MUST NEVER be passed
   * into this method — the query leaves Hesba and reaches a third party.
   */
  search(query: string): Promise<SearchResult>;
}

// ---- Product scanner (visual recognition, ADR-0030) ---------------------------------------

/** One photo for the scanner, already checked (type, size) and stripped of metadata. */
export interface ScanImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: Buffer;
}

export interface VisionResponse {
  /**
   * The model's answer, parsed from JSON but NOT validated: the caller treats it as untrusted
   * input and validates it (zod) before using any of it.
   */
  raw: unknown;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Describes the products visible in the photos (brand, name, flavor, size, packaging, how
   * many). It receives only the photos and a fixed instruction: no shop data, no catalog.
   *
   * @throws ProviderError (classified) on any provider failure or a non-JSON answer.
   */
  recognizeProducts(
    images: ScanImage[],
    options: { signal: AbortSignal },
  ): Promise<VisionResponse>;
}
