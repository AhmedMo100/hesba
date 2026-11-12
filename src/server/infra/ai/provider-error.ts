import "server-only";

/**
 * @file provider-error.ts
 * @description What went wrong at an AI provider, classified so callers can decide: retry
 * (briefly), open the circuit breaker, or tell the operator to fix a setting. The message never
 * contains the provider's raw answer, the API key or billing details.
 */

export type ProviderErrorCategory =
  /** Short-term rate limit (per minute): may clear within seconds. */
  | "rate_limited"
  /** The account's daily / monthly provider quota is used up. */
  | "provider_quota"
  /** The provider refuses for billing / payment reasons. */
  | "billing"
  /** 5xx: the provider is down or overloaded. */
  | "unavailable"
  /** No answer within the deadline. */
  | "timeout"
  /** The API key is missing, wrong or revoked. */
  | "invalid_key"
  /** The configured model does not exist (or was retired). */
  | "model_unavailable"
  /** The request itself was refused (our bug, or an image the provider rejects). */
  | "invalid_request"
  /** The provider answered, but not with what the contract requires. */
  | "invalid_output";

export class ProviderError extends Error {
  constructor(
    readonly category: ProviderErrorCategory,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`AI provider error: ${category}${status ? ` (${status})` : ""}`);
    this.name = "ProviderError";
  }

  /** Worth one more try after a short pause (never for settings, billing or bad output). */
  get transient(): boolean {
    return (
      this.category === "unavailable" ||
      this.category === "timeout" ||
      this.category === "rate_limited"
    );
  }

  /** Counts towards the circuit breaker (the provider side is failing, not this request). */
  get countsAsProviderFailure(): boolean {
    return (
      this.category !== "invalid_request" && this.category !== "invalid_output"
    );
  }
}

function parseRetryAfter(
  header: string | null,
  body: string,
): number | undefined {
  if (header) {
    const n = Number(header);
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
    const at = Date.parse(header);
    if (Number.isFinite(at))
      return Math.max(0, Math.ceil((at - Date.now()) / 1000));
  }
  // Gemini puts it in the body: "retryDelay": "17s".
  const m = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(Number(m[1])) : undefined;
}

/** Classifies a non-2xx provider answer. `body` is read only for classification, never logged whole. */
export function classifyProviderHttpError(
  status: number,
  body: string,
  retryAfterHeader: string | null = null,
): ProviderError {
  const retryAfter = parseRetryAfter(retryAfterHeader, body);
  if (status === 429) {
    // A per-day quota is not a momentary peak; a per-minute one is.
    const daily = /PerDay|per day|daily/i.test(body);
    return new ProviderError(
      daily ? "provider_quota" : "rate_limited",
      status,
      retryAfter,
    );
  }
  if (status === 402 || /billing|payment/i.test(body)) {
    return new ProviderError("billing", status);
  }
  if (
    status === 401 ||
    status === 403 ||
    /API key not valid|API_KEY_INVALID/i.test(body)
  ) {
    return new ProviderError("invalid_key", status);
  }
  if (status === 404) return new ProviderError("model_unavailable", status);
  if (status >= 500)
    return new ProviderError("unavailable", status, retryAfter);
  return new ProviderError("invalid_request", status);
}
