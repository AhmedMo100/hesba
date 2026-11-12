/**
 * QA-29 (docs/QA/FULL-SYSTEM-AUDIT.md): when the AI provider is busy or slow, the user gets a
 * quick 503 "try again" with a retry hint — not a 72-second wait and a 500. `fetch` is stubbed:
 * no request leaves the machine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/server/infra/ai";
import { AppError, toSafeErrorResponse } from "@/server/platform/error";

const provider = new GeminiProvider("test-key", "test-model");
const ask = (signal?: AbortSignal) =>
  provider.generateChatCompletion(
    [{ role: "user", content: "مبيعات النهارده كام؟" }],
    "system",
    undefined,
    { signal },
  );

function respond(status: number, body = "{}") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QA-29 — AI provider busy or slow", () => {
  it.each([503, 500, 429])(
    "a provider %i becomes a 503 with Retry-After, not a 500",
    async (status) => {
      respond(status, '{"error":{"message":"high demand"}}');
      const err = await ask().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(503);
      const res = toSafeErrorResponse(err);
      expect(res.status).toBe(503);
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    },
  );

  it("a provider 400 (our request or key is wrong) stays a 500", async () => {
    respond(400);
    const err = await ask().catch((e: unknown) => e);
    expect((err as AppError).statusCode).toBe(500);
  });

  it("a provider that never answers is cut at the deadline: 503, quickly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal!.reason),
            );
          }),
      ),
    );
    const started = Date.now();
    const err = await ask(AbortSignal.timeout(100)).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((err as AppError).statusCode).toBe(503);
  });

  it("the deadline signal is passed to the HTTP request", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "تمام" }] } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = AbortSignal.timeout(5_000);
    const reply = await ask(signal);
    expect(reply.text).toBe("تمام");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.signal).toBe(signal);
  });
});
