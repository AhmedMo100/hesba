import { afterEach, describe, expect, it, vi } from "vitest";
import { postSale, SaleApiError } from "@/client/shared/api/sales";

/**
 * The Sales screen shows success only when `postSale` resolves (ADR-0019). These tests pin
 * that it resolves ONLY for a recorded sale, and throws for everything else with the
 * server's message.
 */
describe("postSale (client)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const recorded = {
    id: "s1",
    totalPiasters: 2500,
    duplicate: false,
    lines: [
      {
        productId: "p1",
        variantId: "v1",
        quantityBase: 2,
        totalPiasters: 2500,
        stockAfterBase: 8,
      },
    ],
  };

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(body), { status }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: true });
    return fetchMock;
  }

  it("resolves with the server's recorded sale and sends one request", async () => {
    const fetchMock = stubFetch(200, { success: true, data: recorded });
    await expect(
      postSale({ opId: "op-1", variantId: "v1", quantityBase: 2 }),
    ).resolves.toEqual(recorded);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/sales");
    expect(JSON.parse(String(init.body))).toMatchObject({
      opId: "op-1",
      variantId: "v1",
    });
  });

  it.each([400, 404, 409, 422, 500, 503])(
    "throws SaleApiError with the server's message on %i",
    async (status) => {
      stubFetch(status, { error: { message: `رسالة ${status}` } });
      const err = await postSale({ opId: "op" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SaleApiError);
      expect((err as SaleApiError).status).toBe(status);
      expect((err as SaleApiError).message).toBe(`رسالة ${status}`);
    },
  );

  it("throws (never resolves) on a 200 without a recorded sale", async () => {
    stubFetch(200, { success: true });
    await expect(postSale({ opId: "op" })).rejects.toBeInstanceOf(SaleApiError);
  });

  it("throws on a non-JSON error body with a fallback message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 502 })),
    );
    vi.stubGlobal("navigator", { onLine: true });
    const err = (await postSale({ opId: "op" }).catch(
      (e: unknown) => e,
    )) as SaleApiError;
    expect(err).toBeInstanceOf(SaleApiError);
    expect(err.status).toBe(502);
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("does not send anything while offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });
    const err = (await postSale({ opId: "op" }).catch(
      (e: unknown) => e,
    )) as SaleApiError;
    expect(err).toBeInstanceOf(SaleApiError);
    expect(err.status).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the network drops mid-request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    vi.stubGlobal("navigator", { onLine: true });
    await expect(postSale({ opId: "op" })).rejects.toBeInstanceOf(SaleApiError);
  });
});
