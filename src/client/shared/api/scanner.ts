/**
 * @file scanner.ts
 * @description Browser client for the AI product scanner (ADR-0030). Online only: it never
 * queues. A scan returns products matched to the shop's records for the user to confirm; it
 * records nothing. Like the assistant, it is never read from a cache (ADR-0028).
 */
import type { ScanResultView, ScannerQuotaView } from "@/schemas/scanner";

export type { ScanResultView, ScannerQuotaView };
export type { ScanLineView, ScanProductView } from "@/schemas/scanner";

export class ScannerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The server's reason (e.g. `shop_daily`, `global_rpm`); never provider details. */
    readonly category: string | null,
  ) {
    super(message);
  }
}

const OFFLINE =
  "مفيش نت دلوقتي. الاسكان محتاج اتصال — صورك محفوظة هنا، وتقدر تدوّر على المنتجات وتضيفها بإيدك.";

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new ScannerApiError(OFFLINE, 0, "offline");
  }
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string; details?: { category?: string } } })
    | null;
  if (!res.ok || !json) {
    throw new ScannerApiError(
      json?.error?.message || "حصل خطأ في الاسكان، جرّب تاني",
      res.status,
      json?.error?.details?.category ?? null,
    );
  }
  return json;
}

export function getScannerQuota(): Promise<ScannerQuotaView> {
  return send<ScannerQuotaView>("/api/ai/scan/quota");
}

/** `images` are base64 JPEG bytes (no `data:` prefix), already resized on the device. */
export function scanProducts(
  opId: string,
  images: string[],
): Promise<ScanResultView> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.reject(new ScannerApiError(OFFLINE, 0, "offline"));
  }
  return send<ScanResultView>("/api/ai/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opId, images: images.map((data) => ({ data })) }),
  });
}
