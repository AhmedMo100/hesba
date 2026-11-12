/**
 * @file read-cache/index.ts
 * @description The IndexedDB side of the screens' read cache (`shared/api/read-cache`): the
 * last good answer per shop and URL, for reading offline. Plugged in by the app shell.
 */
import { db as defaultDb, type HesbaDatabase } from "../db";
import { lastOutboxStore } from "../outbox";
import type { OfflineCopyStore } from "@/client/shared/api/read-cache";

export function offlineCopyStore(
  database: HesbaDatabase = defaultDb,
): OfflineCopyStore {
  return {
    get: (key) => database.api_cache.get(key),
    put: (entry) => database.api_cache.put(entry),
    clear: () => database.api_cache.clear(),
    lastStoreId: () => lastOutboxStore(),
  };
}
