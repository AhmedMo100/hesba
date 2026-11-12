import "server-only";

/**
 * @file mock-vision.provider.ts
 * @description A deterministic scanner model for tests and for servers with no scanner key
 * configured in development. It never looks at the photos: it answers a fixed (or scripted)
 * list, so automated tests are repeatable and no photo leaves the machine. It is never
 * presented as real recognition: the scan result says `provider: "mock"`.
 */
import type { ScanImage, VisionProvider, VisionResponse } from "./contracts";
import { ProviderError } from "./provider-error";

/** The default answer: one confident item, one unsure flavor, one unreadable item. */
export const MOCK_SCAN_ITEMS = [
  {
    imageIndex: 0,
    brand: "Pepsi",
    nameAr: "بيبسي",
    nameEn: "Pepsi",
    sizeValue: 330,
    sizeUnit: "ml",
    packaging: "can",
    productType: "مياه غازية",
    quantity: 2,
    confidence: 0.94,
  },
  {
    imageIndex: 0,
    brand: "Chipsy",
    nameAr: "شيبسي",
    flavor: "جبنة",
    sizeValue: null,
    sizeUnit: null,
    packaging: "bag",
    quantity: 1,
    confidence: 0.55,
  },
  {
    imageIndex: 0,
    brand: null,
    nameAr: null,
    nameEn: null,
    packaging: "box",
    quantity: 1,
    confidence: 0.15,
  },
];

export type MockVisionScript =
  | { kind: "items"; items: unknown }
  | { kind: "raw"; raw: unknown }
  | { kind: "error"; error: ProviderError }
  | { kind: "hang" };

export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";
  readonly model: string = "mock-vision";
  calls = 0;
  lastImageCount = 0;

  /** `script` may be one answer for every call, or one per call (the last one repeats). */
  constructor(
    private readonly script?: MockVisionScript | MockVisionScript[],
  ) {}

  async recognizeProducts(
    images: ScanImage[],
    options: { signal: AbortSignal },
  ): Promise<VisionResponse> {
    this.calls += 1;
    this.lastImageCount = images.length;
    const scripts = Array.isArray(this.script)
      ? this.script
      : this.script
        ? [this.script]
        : [];
    const step = scripts[Math.min(this.calls - 1, scripts.length - 1)] ?? {
      kind: "items" as const,
      items: MOCK_SCAN_ITEMS,
    };
    if (step.kind === "error") throw step.error;
    if (step.kind === "hang") {
      await new Promise<never>((_, reject) => {
        const fail = () => reject(new ProviderError("timeout"));
        if (options.signal.aborted) fail();
        options.signal.addEventListener("abort", fail, { once: true });
      });
    }
    const raw =
      step.kind === "raw"
        ? step.raw
        : { items: step.kind === "items" ? step.items : [] };
    return {
      raw,
      model: this.model,
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }
}
