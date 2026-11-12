/**
 * QA-17 (docs/QA/FULL-SYSTEM-AUDIT.md): the sync bar tells the truth. It counts the real
 * outbox, never says "synced" while a sale waits or failed, and says why a sale is stuck.
 */
import { describe, expect, it } from "vitest";
import {
  deriveSyncState,
  type QueuedOpStatus,
} from "@/client/app-shell/SyncBar";

const op = (
  status: string,
  last_status: number | null = null,
): QueuedOpStatus => ({
  status,
  last_status,
});
const base = { online: true, sessionExpired: false };

describe("QA-17 — sync bar state from the real queue", () => {
  it("synced only when the queue is known and empty", () => {
    expect(deriveSyncState({ ...base, queue: [] })).toEqual({
      state: "synced",
      pendingCount: 0,
    });
    // Before IndexedDB answers, never claim "synced".
    expect(deriveSyncState({ ...base, queue: undefined }).state).toBe(
      "syncing",
    );
  });

  it("offline after a sale: the bar counts the queued sale (not 0)", () => {
    expect(
      deriveSyncState({ ...base, online: false, queue: [op("pending")] }),
    ).toEqual({ state: "offline", pendingCount: 1 });
  });

  it("online while sales keep failing with 500: still waiting, never 'synced'", () => {
    const r = deriveSyncState({
      ...base,
      queue: [op("pending", 500), op("pending", 500)],
    });
    expect(r).toEqual({ state: "syncing", pendingCount: 2 });
  });

  it("a 503 says the server is updating; a 401 asks to log in", () => {
    expect(
      deriveSyncState({ ...base, queue: [op("pending", 503)] }).state,
    ).toBe("updating");
    expect(
      deriveSyncState({ ...base, queue: [op("pending", 401)] }).state,
    ).toBe("login");
    expect(
      deriveSyncState({ ...base, sessionExpired: true, queue: [] }).state,
    ).toBe("login");
  });

  it("a rejected or quarantined sale needs review, and is counted", () => {
    expect(
      deriveSyncState({
        ...base,
        queue: [op("rejected", 409), op("quarantined", 500), op("pending")],
      }),
    ).toEqual({ state: "needsReview", pendingCount: 3 });
  });
});
