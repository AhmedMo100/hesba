import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { db } from "@/client/offline/db";
import {
  MAX_SYNC_ATTEMPTS,
  backoffDelayMs,
  dismissSaleOp,
  enqueueSale,
  isTransientStatus,
  listSaleOps,
  retrySaleOp,
  scheduleSaleSync,
  sendSaleOp,
  setActiveOutboxStore,
  syncSaleOutbox,
} from "@/client/offline/outbox";

/**
 * QA-04 (ADR-0020): the sales outbox on an IndexedDB implementation (fake-indexeddb) with
 * a scripted server. Browser-level checks against the real app are in
 * `tests/e2e/offline-sales.spec.ts`.
 */
const STORE_A = "store-a";
const STORE_B = "store-b";

type Reply = { status: number; body?: unknown } | "network";
let replies: Reply[] = [];
let requests: Array<Record<string, unknown>> = [];

function recorded(opId: string, duplicate = false) {
  return {
    success: true,
    data: { id: `sale-${opId}`, totalPiasters: 500, duplicate, lines: [] },
  };
}

beforeEach(async () => {
  await db.outbox.clear();
  replies = [];
  requests = [];
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requests.push(body);
      const reply = replies.shift() ?? {
        status: 200,
        body: recorded(String(body.opId)),
      };
      if (reply === "network") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status,
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveOutboxStore(undefined);
});

async function queue(storeId = STORE_A, name = "كولا") {
  const opId = crypto.randomUUID();
  await enqueueSale({
    storeId,
    userId: "u1",
    request: {
      opId,
      id: crypto.randomUUID(),
      variantId: "v1",
      quantityBase: 1,
    },
    summary: { name, label: "1 قطعة", amountPiasters: 500, quantity: 1 },
  });
  return opId;
}

describe("sales outbox", () => {
  it("stores the sale durably before anything is sent, with its op_id and shop", async () => {
    const opId = await queue();
    expect(requests).toHaveLength(0);
    const [op] = await listSaleOps(STORE_A);
    expect(op).toMatchObject({
      op_id: opId,
      type: "sale.create",
      status: "pending",
      attempts: 0,
      store_id: STORE_A,
    });
    expect((op!.payload as { opId: string }).opId).toBe(opId);
  });

  it("marks a sale done only after the server's success, then removes it", async () => {
    const opId = await queue();
    const outcome = await sendSaleOp(opId, STORE_A);
    expect(outcome.kind).toBe("applied");
    expect(requests).toHaveLength(1);
    expect(await listSaleOps(STORE_A)).toEqual([]);
  });

  it("keeps a sale pending (same op_id) when the network drops, then succeeds on retry without a new op_id", async () => {
    const opId = await queue();
    replies = ["network"];
    expect((await sendSaleOp(opId, STORE_A)).kind).toBe("pending");
    const [op] = await listSaleOps(STORE_A);
    expect(op).toMatchObject({
      status: "pending",
      attempts: 1,
      last_status: 0,
    });
    expect(Date.parse(op!.next_attempt_at!)).toBeGreaterThan(Date.now() - 1);

    // The server had committed it: the retry answers "duplicate" — still exactly one sale.
    replies = [{ status: 200, body: recorded(opId, true) }];
    expect((await sendSaleOp(opId, STORE_A)).kind).toBe("applied");
    expect(requests.map((r) => r.opId)).toEqual([opId, opId]);
    expect(await listSaleOps(STORE_A)).toEqual([]);
  });

  it.each([500, 502, 503, 408, 429])(
    "treats %i as transient: pending with backoff",
    async (status) => {
      const opId = await queue();
      replies = [{ status, body: { error: { message: "مشكلة مؤقتة" } } }];
      expect((await sendSaleOp(opId, STORE_A)).kind).toBe("pending");
      expect((await listSaleOps(STORE_A))[0]!.status).toBe("pending");
    },
  );

  it.each([400, 404, 409, 422])(
    "treats %i as a business rejection: kept for review, never resent automatically",
    async (status) => {
      const opId = await queue();
      replies = [
        { status, body: { error: { message: "الكمية في المخزن مش كفاية" } } },
      ];
      const outcome = await sendSaleOp(opId, STORE_A);
      expect(outcome).toMatchObject({ kind: "rejected", status });
      const [op] = await listSaleOps(STORE_A);
      expect(op).toMatchObject({
        status: "rejected",
        last_error: "الكمية في المخزن مش كفاية",
      });
      const report = await syncSaleOutbox(STORE_A);
      expect(report.applied).toBe(0);
      expect(requests).toHaveLength(1); // not sent again
    },
  );

  it("waits for login on 401 without counting an attempt", async () => {
    const opId = await queue();
    replies = [{ status: 401, body: { error: { message: "سجّل دخولك" } } }];
    expect((await sendSaleOp(opId, STORE_A)).kind).toBe("login");
    expect((await listSaleOps(STORE_A))[0]).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("quarantines after MAX_SYNC_ATTEMPTS transient failures (kept, not dropped)", async () => {
    const opId = await queue();
    await db.outbox.update(opId, { attempts: MAX_SYNC_ATTEMPTS - 1 });
    replies = [{ status: 503 }];
    expect((await sendSaleOp(opId, STORE_A)).kind).toBe("quarantined");
    expect((await listSaleOps(STORE_A))[0]!.status).toBe("quarantined");
  });

  it("syncs several queued sales oldest first, each with its own op_id, none twice", async () => {
    const ids = [await queue(), await queue(), await queue()];
    const report = await syncSaleOutbox(STORE_A);
    expect(report).toMatchObject({ applied: 3, rejected: 0, pending: 0 });
    expect(requests.map((r) => r.opId)).toEqual(ids);
    expect(await syncSaleOutbox(STORE_A)).toMatchObject({ applied: 0 });
    expect(requests).toHaveLength(3);
  });

  it("stops at the first lost answer and keeps the rest pending", async () => {
    await queue();
    await queue();
    replies = ["network"];
    const report = await syncSaleOutbox(STORE_A);
    expect(report.stoppedBy).toBe("offline");
    expect(requests).toHaveLength(1);
    expect((await listSaleOps(STORE_A)).map((o) => o.status)).toEqual([
      "pending",
      "pending",
    ]);
  });

  it("sends nothing while the browser is offline", async () => {
    await queue();
    vi.stubGlobal("navigator", { onLine: false });
    const report = await syncSaleOutbox(STORE_A);
    expect(report).toMatchObject({ stoppedBy: "offline", pending: 1 });
    expect(requests).toHaveLength(0);
  });

  it("recovers a sale left `sending` by a closed tab and sends it again with the same op_id", async () => {
    const opId = await queue();
    await db.outbox.update(opId, { status: "sending" });
    const report = await syncSaleOutbox(STORE_A);
    expect(report.applied).toBe(1);
    expect(requests.map((r) => r.opId)).toEqual([opId]);
  });

  it("never sends the same op twice when a manual send and a sync race", async () => {
    const opId = await queue();
    await Promise.all([
      sendSaleOp(opId, STORE_A),
      syncSaleOutbox(STORE_A),
      sendSaleOp(opId, STORE_A),
    ]);
    expect(requests).toHaveLength(1);
    expect(await listSaleOps(STORE_A)).toEqual([]);
  });

  it("only sends a shop's own sales while that shop is signed in", async () => {
    const aOp = await queue(STORE_A, "منتج أ");
    await queue(STORE_B, "منتج ب");
    expect((await sendSaleOp(aOp, STORE_B)).kind).toBe("missing");
    expect(requests).toHaveLength(0);
    const report = await syncSaleOutbox(STORE_B);
    expect(report.applied).toBe(1);
    expect(requests).toHaveLength(1);
    expect((await listSaleOps(STORE_A)).map((o) => o.summary.name)).toEqual([
      "منتج أ",
    ]);
    expect(await listSaleOps(STORE_B)).toEqual([]);
  });

  it("sends a queued sale with the shop it was made in, and keeps it pending if the server says another shop is signed in", async () => {
    const opId = await queue(STORE_A);
    replies = [
      {
        status: 403,
        body: { error: { code: "STORE_MISMATCH", message: "محل تاني" } },
      },
    ];
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect((await sendSaleOp(opId, STORE_A)).kind).toBe("login");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-Hesba-Store-Id"]).toBe(
      STORE_A,
    );
    expect((await listSaleOps(STORE_A))[0]).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("after switching to another shop in this tab, the old shop's sales are not sent", async () => {
    await queue(STORE_A);
    setActiveOutboxStore(STORE_B);
    const report = await syncSaleOutbox(STORE_A); // e.g. a retry timer from before the switch
    expect(report.stoppedBy).toBe("login");
    expect(requests).toHaveLength(0);
    setActiveOutboxStore(null); // logged out: nothing is sent at all
    expect((await syncSaleOutbox(STORE_A)).applied).toBe(0);
    setActiveOutboxStore(STORE_A);
    expect((await syncSaleOutbox(STORE_A)).applied).toBe(1);
  });

  it("a sync requested while another runs is queued, not dropped (shop known mid-sync)", async () => {
    vi.stubGlobal("window", { dispatchEvent: () => true });
    const opId = await queue(STORE_A);
    scheduleSaleSync(STORE_B, { now: true }); // e.g. the remembered shop on first render
    scheduleSaleSync(STORE_A, { now: true }); // …then the real session arrives
    await vi.waitFor(async () => {
      expect(await listSaleOps(STORE_A)).toEqual([]);
    });
    expect(requests.map((r) => r.opId)).toEqual([opId]);
  });

  it("retry re-queues a rejected sale with the same op_id; dismiss removes it", async () => {
    const opId = await queue();
    replies = [{ status: 409, body: { error: { message: "مش كفاية" } } }];
    await sendSaleOp(opId, STORE_A);
    await retrySaleOp(opId, STORE_A);
    await syncSaleOutbox(STORE_A);
    expect(requests.map((r) => r.opId)).toEqual([opId, opId]);
    expect(await listSaleOps(STORE_A)).toEqual([]);

    const other = await queue();
    replies = [{ status: 409, body: { error: { message: "مش كفاية" } } }];
    await sendSaleOp(other, STORE_A);
    await dismissSaleOp(other, STORE_A);
    expect(await listSaleOps(STORE_A)).toEqual([]);
  });

  it("backoff is bounded and transient statuses are classified", () => {
    for (let a = 0; a < 20; a++) {
      const d = backoffDelayMs(a, () => 0.999);
      expect(d).toBeLessThanOrEqual(31_000);
      expect(d).toBeGreaterThanOrEqual(0);
    }
    expect(backoffDelayMs(0, () => 0)).toBe(0);
    expect([0, 408, 429, 500, 503].every(isTransientStatus)).toBe(true);
    expect([400, 401, 404, 409, 422].some(isTransientStatus)).toBe(false);
  });
});
