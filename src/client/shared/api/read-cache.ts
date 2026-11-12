/**
 * @file read-cache.ts
 * @description The screens' read cache: fast navigation without re-fetching everything, and
 * the last good answer for reading offline — never stale after a write, never another shop's.
 *
 * How a read (`apiGet`) is answered:
 * 1. **Memory, fresh**: the same shop asked the same URL less than `maxAgeMs` ago and nothing
 *    was written since → that answer, no request (navigating back and forth is instant).
 * 2. **Network**: otherwise the server (identical requests in flight are shared). A good
 *    answer is kept in memory and — for the screens listed in {@link OFFLINE_READABLE} — in
 *    IndexedDB for this shop.
 * 3. **Offline copy**: the request failed for lack of network → this shop's last good answer
 *    from IndexedDB, marked `x-hesba-source: offline` so the screen can say so. Never used when
 *    the server answered (an error answer is returned as is).
 *
 * Correctness rules:
 * - Every successful write to `/api/*` from this tab (any method but GET) drops the whole memory
 *   cache and tells the other tabs ({@link installWriteInvalidation}): balances, stock and
 *   money are re-read after any change. Other devices' changes are seen within `maxAgeMs`.
 * - Entries are keyed by shop; signing out / switching shop clears memory and IndexedDB
 *   ({@link clearReadCache}).
 * - Only JSON GETs of the app's own API; auth/session and AI are never cached.
 */

import { dedupedGet } from "./dedupe";

/** Where offline copies are kept (IndexedDB, provided by `client/offline/read-cache`). */
export interface OfflineCopyStore {
  get(
    key: string,
  ): Promise<
    | { store_id: string; status: number; body: string; saved_at: number }
    | undefined
  >;
  put(entry: {
    key: string;
    store_id: string;
    url: string;
    status: number;
    body: string;
    saved_at: number;
  }): Promise<unknown>;
  clear(): Promise<unknown>;
  /** The shop that owns this device's offline data when no session is loaded (offline). */
  lastStoreId(): string | undefined;
}

/** How long a memory answer is reused without asking the server (no write in between). */
const DEFAULT_MAX_AGE_MS = 30_000;
const MAX_AGE_BY_PREFIX: Array<[string, number]> = [
  // The product list is mostly the shared catalog; product writes still drop it at once.
  ["/api/products", 120_000],
];
/** Screens readable offline (the rest need the network). */
const OFFLINE_READABLE = [
  "/api/products",
  "/api/stock",
  "/api/people",
  "/api/alerts",
  "/api/reports/home",
  "/api/expenses",
  "/api/sales",
  "/api/promotions",
  "/api/machines",
];
const NEVER_CACHED = ["/api/auth", "/api/ai", "/api/sync"];
const MAX_OFFLINE_BODY = 3_000_000;
export const OFFLINE_NO_COPY_MESSAGE =
  "مفيش نت، والصفحة دي لسه متحفظتش على الجهاز. هتظهر أول ما النت يرجع.";
const CHANNEL = "hesba-read-cache";

interface MemoryEntry {
  storeId: string;
  body: string;
  status: number;
  at: number;
}

const memory = new Map<string, MemoryEntry>();
let generation = 0;
let offlineStore: OfflineCopyStore | null = null;

/** Plugs in the offline copy store (the app shell does it once). */
export function setOfflineCopyStore(store: OfflineCopyStore | null): void {
  offlineStore = store;
}

function currentStoreId(): string | null {
  try {
    return (
      window.sessionStorage.getItem("hesba_current_store_id") ||
      offlineStore?.lastStoreId() ||
      null
    );
  } catch {
    return null;
  }
}

const pathOf = (url: string) => url.split("?")[0] ?? url;
const matches = (url: string, prefixes: string[]) =>
  prefixes.some((p) => pathOf(url) === p || pathOf(url).startsWith(`${p}/`));

function maxAgeFor(url: string): number {
  const hit = MAX_AGE_BY_PREFIX.find(([p]) => matches(url, [p]));
  return hit ? hit[1] : DEFAULT_MAX_AGE_MS;
}

function respond(
  body: string,
  status: number,
  source: "memory" | "offline",
  savedAt: number,
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json",
      "x-hesba-source": source,
      "x-hesba-saved-at": String(savedAt),
    },
  });
}

/** True when a response came from the offline copy (the screen may say "آخر نسخة"). */
export function isOfflineCopy(res: Response): boolean {
  return res.headers.get("x-hesba-source") === "offline";
}

/**
 * A GET of the app's API through the read cache (see the file comment). Same contract as
 * `fetch(url)`: resolves with a Response (possibly an error status), rejects only when there is
 * no network AND no offline copy.
 */
export async function apiGet(
  url: string,
  opts: { maxAgeMs?: number; force?: boolean } = {},
): Promise<Response> {
  const storeId = currentStoreId();
  if (!storeId || matches(url, NEVER_CACHED)) return dedupedGet(url);
  const key = `${storeId} ${url}`;
  const maxAge = opts.maxAgeMs ?? maxAgeFor(url);
  const hit = memory.get(key);
  if (!opts.force && hit && Date.now() - hit.at < maxAge) {
    return respond(hit.body, hit.status, "memory", hit.at);
  }

  const startedAt = generation;
  let res: Response;
  try {
    res = await dedupedGet(url);
  } catch (err) {
    // No network: this shop's last good answer, if the screen is readable offline.
    if (matches(url, OFFLINE_READABLE)) {
      const saved = await offlineStore?.get(key).catch(() => undefined);
      if (saved && saved.store_id === storeId) {
        return respond(saved.body, saved.status, "offline", saved.saved_at);
      }
    }
    // Offline with nothing saved: say so (not a generic "loading" or "server error").
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const offline = new Error(OFFLINE_NO_COPY_MESSAGE);
      offline.name = "OfflineNoCopyError";
      throw offline;
    }
    throw err;
  }
  if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
    const body = await res.clone().text();
    // A write landed while this request was in flight: its answer may predate the write.
    if (startedAt === generation && currentStoreId() === storeId) {
      const at = Date.now();
      memory.set(key, { storeId, body, status: res.status, at });
      if (matches(url, OFFLINE_READABLE) && body.length <= MAX_OFFLINE_BODY) {
        void offlineStore
          ?.put({
            key,
            store_id: storeId,
            url,
            status: res.status,
            body,
            saved_at: at,
          })
          .catch(() => undefined);
      }
    }
  }
  return res;
}

/** Drops every memory answer (after a write). Offline copies stay: they are the last truth. */
export function invalidateReadCache(fromOtherTab = false): void {
  generation += 1;
  memory.clear();
  if (!fromOtherTab) {
    try {
      new BroadcastChannel(CHANNEL).postMessage("invalidate");
    } catch {
      // No BroadcastChannel: other tabs refresh within maxAge.
    }
  }
}

/** Sign-out / shop switch: memory and every offline copy are removed. */
export async function clearReadCache(): Promise<void> {
  generation += 1;
  memory.clear();
  await offlineStore?.clear().catch(() => undefined);
}

let installed = false;
/**
 * Wraps `window.fetch` once so that any successful write to the app's API (POST, PUT, PATCH,
 * DELETE on a same-origin `/api/` URL) invalidates the read cache — one place for all screens,
 * so no mutation can leave a stale balance or stock figure behind. Reads are untouched.
 */
export function installWriteInvalidation(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    try {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (method !== "GET" && method !== "HEAD" && res.ok) {
        const raw = input instanceof Request ? input.url : String(input);
        const u = new URL(raw, window.location.origin);
        if (
          u.origin === window.location.origin &&
          u.pathname.startsWith("/api/")
        ) {
          invalidateReadCache();
        }
      }
    } catch {
      // Never break the request because of the cache.
    }
    return res;
  };
  try {
    new BroadcastChannel(CHANNEL).onmessage = () => invalidateReadCache(true);
  } catch {
    // No BroadcastChannel.
  }
}
