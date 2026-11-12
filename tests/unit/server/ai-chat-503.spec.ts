/**
 * The Assistant's `POST /api/ai/chat` 503 (2026-11-12). Root causes, measured against the real
 * Gemini API with the app's prompt and tools:
 * 1. Gemini's default "thinking" made one tool-choosing call take ~27 s, past the 20 s reply
 *    budget, so business questions always ended as a 503 → thinking is off by default.
 * 2. The follow-up call sent the tool results without the model's own `functionCall` turn,
 *    so the model could not use them → the turn is replayed, results grouped in one turn.
 * 3. A missing key / retired model was an unexplained 500 → a controlled 503 that says so.
 * `fetch` is stubbed: nothing leaves the machine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/server/infra/ai";
import { AppError } from "@/server/platform/error";

afterEach(() => {
  vi.unstubAllGlobals();
});

function capture(
  reply: unknown = { candidates: [{ content: { parts: [{ text: "تمام" }] } }] },
) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply), { status: 200 });
    }),
  );
  return bodies;
}

describe("AI 503 — Gemini adapter", () => {
  it("asks without thinking, so a reply fits the 20 s budget", async () => {
    const bodies = capture();
    await new GeminiProvider("k", "m").generateChatCompletion(
      [{ role: "user", content: "مبيعات النهارده؟" }],
      "sys",
    );
    expect(
      (bodies[0]!.generationConfig as { thinkingConfig: unknown })
        .thinkingConfig,
    ).toEqual({ thinkingBudget: 0 });
  });

  it("returns the model's tool-call parts, and replays them before the results", async () => {
    const parts = [
      {
        functionCall: { name: "getSalesSummary", args: { period: "today" } },
        thoughtSignature: "sig1",
      },
      {
        functionCall: { name: "getExpensesSummary", args: { period: "today" } },
        thoughtSignature: "sig2",
      },
    ];
    capture({ candidates: [{ content: { parts } }] });
    const provider = new GeminiProvider("k", "m");
    const first = await provider.generateChatCompletion(
      [{ role: "user", content: "مبيعات ومصاريف النهارده؟" }],
      "sys",
      [
        {
          name: "getSalesSummary",
          description: "d",
          parameters: { type: "object", properties: {} },
        },
      ],
    );
    expect(first.toolCalls?.map((c) => c.name)).toEqual([
      "getSalesSummary",
      "getExpensesSummary",
    ]);
    expect(first.providerParts).toEqual(parts);

    const bodies = capture();
    await provider.generateChatCompletion(
      [
        { role: "user", content: "مبيعات ومصاريف النهارده؟" },
        {
          role: "assistant",
          content: "",
          toolCalls: first.toolCalls,
          providerParts: first.providerParts,
        },
        { role: "tool", name: "getSalesSummary", content: '{"total":1}' },
        { role: "tool", name: "getExpensesSummary", content: '{"total":2}' },
      ],
      "sys",
    );
    const contents = bodies[0]!.contents as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[1]!.parts).toEqual(parts); // signatures kept
    expect(
      contents[2]!.parts.map(
        (p) => (p.functionResponse as { name: string }).name,
      ),
    ).toEqual(["getSalesSummary", "getExpensesSummary"]);
  });

  it("ignores thought text in the answer", async () => {
    capture({
      candidates: [
        {
          content: {
            parts: [
              { text: "تفكير داخلي", thought: true },
              { text: "الإجابة" },
            ],
          },
        },
      ],
    });
    const r = await new GeminiProvider("k", "m").generateChatCompletion(
      [{ role: "user", content: "؟" }],
      "sys",
    );
    expect(r.text).toBe("الإجابة");
  });

  it("no key on the server: a clear 503, and no request is sent", async () => {
    const prev = {
      a: process.env.GEMINI_API_KEY,
      b: process.env.HESBA_GEMINI_API_KEY,
    };
    delete process.env.GEMINI_API_KEY;
    delete process.env.HESBA_GEMINI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const err = await new GeminiProvider("", "m")
        .generateChatCompletion([{ role: "user", content: "؟" }], "sys")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(503);
      expect((err as AppError).details).toEqual({
        reason: "ai_not_configured",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (prev.a !== undefined) process.env.GEMINI_API_KEY = prev.a;
      if (prev.b !== undefined) process.env.HESBA_GEMINI_API_KEY = prev.b;
    }
  });

  it.each([401, 403, 404])(
    "a refused key or retired model (%i) is the same controlled 503",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status })),
      );
      const err = await new GeminiProvider("k", "m")
        .generateChatCompletion([{ role: "user", content: "؟" }], "sys")
        .catch((e: unknown) => e);
      expect((err as AppError).statusCode).toBe(503);
      expect((err as AppError).details).toEqual({
        reason: "ai_not_configured",
      });
    },
  );

  it("an exhausted provider quota is a 503 that says so (not 'busy'), with a longer retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            '{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}',
            { status: 429 },
          ),
      ),
    );
    const err = (await new GeminiProvider("k", "m")
      .generateChatCompletion([{ role: "user", content: "؟" }], "sys")
      .catch((e: unknown) => e)) as AppError;
    expect(err.statusCode).toBe(503);
    expect(err.details).toEqual({ reason: "ai_provider_quota" });
    expect(err.retryAfterSeconds).toBe(300);
  });
});
