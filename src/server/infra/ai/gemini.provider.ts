import "server-only";
import type {
  AIProvider,
  ChatMessage,
  ToolDefinition,
  ProviderResponse,
  ToolCall,
} from "./contracts";
import { logger } from "@/server/platform/logger";
import { AppError } from "@/server/platform/error";

/** Seconds suggested in `Retry-After` when the provider is busy or too slow (QA-29). */
const PROVIDER_RETRY_AFTER_SECONDS = 30;

/** The provider is busy or too slow: a 503 the user can retry, with a retry hint. */
export function providerBusy(): AppError {
  const err = AppError.serviceUnavailable(
    "المساعد مشغول دلوقتي ومردّش في الوقت. جرّب تاني بعد شوية، ورصيد رسالتك رجعلك.",
  );
  err.retryAfterSeconds = PROVIDER_RETRY_AFTER_SECONDS;
  return err;
}

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey =
      apiKey ||
      process.env.GEMINI_API_KEY ||
      process.env.HESBA_GEMINI_API_KEY ||
      "";
    this.modelName =
      modelName ||
      process.env.GEMINI_MODEL ||
      process.env.HESBA_GEMINI_MODEL ||
      DEFAULT_GEMINI_MODEL;

    if (!this.apiKey) {
      logger.warn(
        "GeminiProvider instantiated without GEMINI_API_KEY. Calls will fail unless configured.",
      );
    }
  }

  async generateChatCompletion(
    messages: ChatMessage[],
    systemInstruction: string,
    tools?: ToolDefinition[],
    options?: { signal?: AbortSignal },
  ): Promise<ProviderResponse> {
    if (!this.apiKey) {
      throw AppError.internal(
        "مفتاح مزود الذكاء الاصطناعي (Gemini API) غير مهيأ في الخادم",
      );
    }

    const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(this.modelName)}:generateContent?key=${this.apiKey}`;

    // Map messages to Gemini contents format
    const contents: Array<{
      role: "user" | "model";
      parts: Array<
        | { text: string }
        | {
            functionCall?: {
              name: string;
              args: Record<string, unknown>;
            };
          }
        | {
            functionResponse?: {
              name: string;
              response: { content: string };
            };
          }
      >;
    }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        continue; // System instruction is passed separately in Gemini API
      }

      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "assistant") {
        contents.push({
          role: "model",
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === "tool") {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: msg.name || "tool_result",
                response: { content: msg.content },
              },
            },
          ],
        });
      }
    }

    // Prepare function declarations if tools are provided
    let geminiTools: Array<{ function_declarations: unknown[] }> | undefined =
      undefined;
    if (tools && tools.length > 0) {
      geminiTools = [
        {
          function_declarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const requestPayload: Record<string, unknown> = {
      contents,
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        temperature: 0.2, // Low temperature for high factual precision
        maxOutputTokens: 1024,
      },
    };

    if (geminiTools) {
      requestPayload.tools = geminiTools;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          {
            status: response.status,
            errorBody: errorBody.slice(0, 300),
            model: this.modelName,
          },
          "Gemini API returned non-200 response",
        );
        // Busy or down (429, 5xx — e.g. 503 "high demand"): a temporary 503 with a retry hint,
        // not a 500 (QA-29). Other statuses (bad key, bad request) are our fault: 500.
        if (response.status === 429 || response.status >= 500) {
          throw providerBusy();
        }
        throw AppError.internal("تعذر الحصول على رد من مزود الذكاء الاصطناعي");
      }

      const data = await response.json();
      return this.parseGeminiResponse(data);
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      // The reply's deadline passed (AbortSignal.timeout) or the request was aborted.
      if (
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
        logger.warn({ model: this.modelName }, "Gemini API request timed out");
        throw providerBusy();
      }
      logger.error({ err, model: this.modelName }, "Gemini API request failed");
      throw AppError.internal(
        "حدث خطأ أثناء الاتصال بمزود الذكاء الاصطناعي، تم استرجاع رصيد الرسالة بأمان",
      );
    }
  }

  private parseGeminiResponse(data: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: {
            name: string;
            args?: Record<string, unknown>;
          };
        }>;
      };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  }): ProviderResponse {
    const candidate = data.candidates?.[0];
    if (!candidate) {
      return { text: "لم يتمكن المساعد من توليد إجابة مناسبة." };
    }

    const parts = candidate.content?.parts || [];
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        text += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
    }

    const usage = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined;

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}
