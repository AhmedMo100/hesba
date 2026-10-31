import "server-only";
import { AIProvider } from "./ai-provider.interface";
import {
  ChatMessage,
  ToolDefinition,
  ProviderResponse,
  ToolCall,
} from "../types";
import { DEFAULT_GEMINI_MODEL, GEMINI_API_BASE_URL } from "../constants";
import { logger } from "@/server/platform/logger";
import { AppError } from "@/server/platform/error";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    this.apiKey = apiKey || process.env.HESBA_GEMINI_API_KEY || "";
    this.modelName =
      modelName || process.env.HESBA_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

    if (!this.apiKey) {
      logger.warn(
        "GeminiProvider instantiated without HESBA_GEMINI_API_KEY. Calls will fail unless configured.",
      );
    }
  }

  async generateChatCompletion(
    messages: ChatMessage[],
    systemInstruction: string,
    tools?: ToolDefinition[],
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
        throw AppError.internal("تعذر الحصول على رد من مزود الذكاء الاصطناعي");
      }

      const data = await response.json();
      return this.parseGeminiResponse(data);
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
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
