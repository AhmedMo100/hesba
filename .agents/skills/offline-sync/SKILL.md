---
name: offline-sync
description: Offline-first architecture using Dexie IndexedDB, Outbox queue, op_id idempotency, and event-driven sync with zero periodic polling.
---

# Offline-First & Sync Protocol Skill

## When to Use

- Implementing or modifying mutations in `src/client/` (sales, products, inventory, expenses).
- Updating Dexie IndexedDB schema or local repositories.
- Working on the sync engine in `src/client/shared/sync/`.
- Implementing or altering `/api/sync/push` or `/api/sync/pull` route handlers.

## Core Rules & Principles

1. **The UI Never Waits for the Server**: Core user actions (selling, stock entry, expenses) commit locally to Dexie and the Outbox in a single transaction. The UI updates instantly.
2. **Event-Driven Only — No Polling**: Periodic polling with `setInterval` is strictly forbidden. Polling drains mobile battery and wastes server bandwidth.
3. **Idempotent Operations via `op_id`**: Every operation generated on the client receives a unique UUID v7 `op_id`. Sending the same operation multiple times must result in exactly one execution on the server.
4. **Append-Only Outbox**: Unsynced changes are appended to the local Dexie `outbox` table. They remain there until acknowledged by the server.
5. **Rebase on Pull**: When new server changes arrive via pull, apply them locally and re-apply pending outbox mutations on top.

## Implementation Steps

### 1. Local Mutation (One Dexie Transaction)

Write domain data and the outbox operation together:

```ts
import { db } from "@/client/shared/db";
import { v7 as uuidv7 } from "uuid";

await db.transaction("rw", [db.sales, db.outbox], async () => {
  const opId = uuidv7();
  await db.sales.add(saleData);
  await db.outbox.add({
    opId,
    type: "sale.create",
    payload: saleData,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
});
// Trigger sync event immediately after write
syncEngine.triggerDebouncedSync();
```

### 2. Event-Driven Sync Triggers (Zero `setInterval`)

Sync fires exclusively on specific events:

- **Write Debounce**: ~500ms after the last user action.
- **App Startup**: when the PWA is opened or loaded.
- **Online Event**: `window.addEventListener('online', triggerSync)`.
- **Visibility / Tab Focus**: `document.addEventListener('visibilitychange', () => !document.hidden && triggerSync())`.
- **Manual User Action**: clicking the "زامن" (Sync) button in the UI.

### 3. Server Push Handling (`/api/sync/push`)

Each pushed operation is evaluated in an independent transaction:

1. Check `sync_ops` table for existing `op_id`.
2. If already processed, return status `duplicate` (200 OK) without re-executing.
3. Validate payload with zod.
4. Execute domain handler inside `withTenant`.
5. Record `sync_ops(op_id, store_id, ...)` and append to `change_log`.

### 4. Pull Handling (`/api/sync/pull`)

- Client passes `cursor` (last known `seq`).
- Server returns all changes where `change_log.seq > cursor`.
- If no changes, return `204 No Content`.
- Client updates local Dexie tables and marks synced outbox operations as acknowledged.

## Mandatory Checks

- [ ] Are UI mutations committing to Dexie and Outbox in a single atomic transaction?
- [ ] Is `setInterval` completely absent from the codebase?
- [ ] Does every operation payload include a client-generated UUID v7 `op_id`?
- [ ] Does `/api/sync/push` check `sync_ops.op_id` before executing the handler?
- [ ] Are offline scenarios tested (selling while disconnected, reconnecting, deduplicating)?

## Documentation Links

- [docs/03-data.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/03-data.md) — Sync protocol specification, outbox schema, and operation types.
- [docs/02-arch.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/02-arch.md) — Architecture, client/server boundaries, and Dexie setup.
- [docs/06-quality.md](file:///Users/ahmedtarek/Desktop/Web%20Projects/Full-Stack/Hesba/docs/06-quality.md) — Offline and sync testing scenarios (network drop, duplicate push).
