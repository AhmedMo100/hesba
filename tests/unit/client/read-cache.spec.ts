/**
 * The screens' read cache: instant re-reads, re-read after any write, never another shop's
 * answer, and the shop's last good answer offline (IndexedDB) — cleared on sign-out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { HesbaDatabase } from "@/client/offline/db";
import { offlineCopyStore } from "@/client/offline/read-cache";
import {
  apiGet,
  clearReadCache,
  installWriteInvalidation,
  invalidateReadCache,
  isOfflineCopy,
  setOfflineCopyStore,
} from "@/client/shared/api/read-cache";

// Minimal browser globals (node environment).
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = globalThis;
g.sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};
g.location = { origin: "http://localhost" };

const NAME = "hesba_test_read_cache";
let db: HesbaDatabase;
let server: { calls: string[]; down: boolean; value: number; status: number };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(async () => {
  await Dexie.delete(NAME);
  db = new HesbaDatabase(NAME);
  await db.open();
  setOfflineCopyStore(offlineCopyStore(db));
  await clearReadCache();
  server = { calls: [], down: false, value: 1, status: 200 };
  window.sessionStorage.setItem("hesba_current_store_id", "shop-a");
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    server.calls.push(`${init?.method ?? "GET"} ${url}`);
    if (server.down) throw new TypeError("Failed to fetch");
    if ((init?.method ?? "GET") !== "GET") {
      server.value += 1;
      return json({ ok: true });
    }
    return json({ value: server.value }, server.status);
  });
  window.fetch = fake as unknown as typeof fetch;
});

afterEach(() => {
  window.sessionStorage.clear();
});

const read = async (url = "/api/stock") => (await apiGet(url)).json();
const gets = () => server.calls.filter((c) => c.startsWith("GET")).length;

describe("read cache", () => {
  it("navigating back within the window makes no second request", async () => {
    expect(await read()).toEqual({ value: 1 });
    expect(await read()).toEqual({ value: 1 });
    expect(gets()).toBe(1);
  });

  it("a successful write (any screen, through fetch) re-reads: no stale stock or money", async () => {
    installWriteInvalidation();
    await read();
    await window.fetch("http://localhost/api/sales", {
      method: "POST",
      body: "{}",
    });
    expect(await read()).toEqual({ value: 2 });
    expect(gets()).toBe(2);
  });

  it("each shop has its own answers", async () => {
    await read();
    window.sessionStorage.setItem("hesba_current_store_id", "shop-b");
    await read();
    expect(gets()).toBe(2);
  });

  it("offline: the shop's last good answer, marked as a copy; never another shop's", async () => {
    await read("/api/people?section=owedToMe");
    invalidateReadCache();
    server.down = true;
    const res = await apiGet("/api/people?section=owedToMe");
    expect(isOfflineCopy(res)).toBe(true);
    expect(await res.json()).toEqual({ value: 1 });

    window.sessionStorage.setItem("hesba_current_store_id", "shop-b");
    await expect(apiGet("/api/people?section=owedToMe")).rejects.toThrow();
  });

  it("an error answer is not cached, and online errors are never replaced by the copy", async () => {
    await read();
    invalidateReadCache();
    server.status = 500;
    const res = await apiGet("/api/stock");
    expect(res.status).toBe(500);
    server.status = 200;
    expect(await read()).toEqual({ value: 1 });
  });

  it("sign-out removes every offline copy", async () => {
    await read();
    await clearReadCache();
    server.down = true;
    await expect(apiGet("/api/stock")).rejects.toThrow();
    expect(await db.api_cache.count()).toBe(0);
  });

  it("auth and AI are never cached", async () => {
    await read("/api/auth/session");
    await read("/api/auth/session");
    expect(gets()).toBe(2);
  });
});
