/**
 * Performance pass (ADR-0027): concurrent identical GETs share one request, each caller gets
 * its own body, and nothing is reused after the answer arrived (no stale data).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInflightRequests, dedupedGet } from "@/client/shared/api/dedupe";

afterEach(() => {
  vi.unstubAllGlobals();
  clearInflightRequests();
});

describe("dedupedGet", () => {
  it("two concurrent calls make one request and both read the body", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify({ n: calls }), { status: 200 });
      }),
    );
    const [a, b] = await Promise.all([
      dedupedGet("/api/alerts"),
      dedupedGet("/api/alerts"),
    ]);
    expect(calls).toBe(1);
    expect(await a.json()).toEqual({ n: 1 });
    expect(await b.json()).toEqual({ n: 1 });
  });

  it("a call after the answer arrived goes to the server again (never stale)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify({ n: calls }), { status: 200 });
      }),
    );
    await (await dedupedGet("/api/stock")).json();
    const second = await (await dedupedGet("/api/stock")).json();
    expect(calls).toBe(2);
    expect(second).toEqual({ n: 2 });
  });

  it("different URLs are different requests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([dedupedGet("/api/a"), dedupedGet("/api/b")]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
