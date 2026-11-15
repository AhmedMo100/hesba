import "server-only";

/**
 * @file gemini-vision.provider.ts
 * @description The product scanner's Gemini adapter: photos in, a JSON list of visible
 * products out (structured output). It sends only the photos and the fixed instruction below —
 * never the shop's name, catalog, prices or stock (ADR-0030). Matching to the shop's products
 * happens on the server afterwards.
 *
 * Configuration: `HESBA_AI_SCANNER_API_KEY` (falls back to `GEMINI_API_KEY`), model
 * `HESBA_AI_SCANNER_MODEL` (default `gemini-3.5-flash-lite`).
 */
import type { ScanImage, VisionProvider, VisionResponse } from "./contracts";
import { ProviderError, classifyProviderHttpError } from "./provider-error";
import { logger } from "@/server/platform/logger";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_SCANNER_MODEL = "gemini-3.5-flash-lite";

const INSTRUCTION = `You identify retail grocery / supermarket products in photos taken in a shop in Egypt.
For every distinct product visible, return one item. Rules:
- Read only what is visible on the packaging. Never guess a price, a barcode or a stock level.
- brand: the brand as printed (e.g. "Pepsi", "Juhayna", "Chipsy"). nameAr: the usual Egyptian Arabic product name (e.g. "بيبسي", "لبن جهينة", "شيبسي"). nameEn: the English/Latin name if printed.
- flavor (e.g. "جبنة", "ليمون"), sizeValue + sizeUnit (one of g, kg, ml, l, piece) when printed, packaging (can, bottle, bag, box, carton, pack, jar, other), productType (e.g. "مياه غازية", "لبن").
- quantity: how many units of this exact product are visible in that photo (count them; 1 if unsure).
- imageIndex: the 0-based index of the photo the item is in. The same product in two photos is two items.
- confidence: 0..1, how sure you are of brand + product + size together. Use low values when text is unreadable.
- If no product is identifiable, return an empty list.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          imageIndex: { type: "INTEGER" },
          brand: { type: "STRING", nullable: true },
          nameAr: { type: "STRING", nullable: true },
          nameEn: { type: "STRING", nullable: true },
          flavor: { type: "STRING", nullable: true },
          sizeValue: { type: "NUMBER", nullable: true },
          sizeUnit: { type: "STRING", nullable: true },
          packaging: { type: "STRING", nullable: true },
          productType: { type: "STRING", nullable: true },
          quantity: { type: "INTEGER" },
          confidence: { type: "NUMBER" },
        },
        required: ["imageIndex", "quantity", "confidence"],
      },
    },
  },
  required: ["items"],
};

export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey =
      apiKey ||
      process.env.HESBA_AI_SCANNER_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.HESBA_GEMINI_API_KEY ||
      "";
    this.model =
      model || process.env.HESBA_AI_SCANNER_MODEL || DEFAULT_SCANNER_MODEL;
  }

  async recognizeProducts(
    images: ScanImage[],
    options: { signal: AbortSignal },
  ): Promise<VisionResponse> {
    if (!this.apiKey) throw new ProviderError("invalid_key");
    const parts: Array<Record<string, unknown>> = [{ text: INSTRUCTION }];
    images.forEach((img, i) => {
      parts.push({ text: `Photo ${i}:` });
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.data.toString("base64"),
        },
      });
    });

    let response: Response;
    try {
      response = await fetch(
        `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          // The key goes in a header, never in the URL (URLs end up in logs).
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 2048,
              responseMimeType: "application/json",
              responseSchema: RESPONSE_SCHEMA,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: options.signal,
        },
      );
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
        throw new ProviderError("timeout");
      }
      throw new ProviderError("unavailable");
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 2000);
      const err = classifyProviderHttpError(
        response.status,
        body,
        response.headers.get("retry-after"),
      );
      logger.warn(
        { status: response.status, category: err.category, model: this.model },
        "Gemini vision request refused",
      );
      throw err;
    }

    const data = (await response.json().catch(() => null)) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    } | null;
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ProviderError("invalid_output", response.status);
    }
    return {
      raw,
      model: this.model,
      usage: {
        promptTokens: data?.usageMetadata?.promptTokenCount,
        completionTokens: data?.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
