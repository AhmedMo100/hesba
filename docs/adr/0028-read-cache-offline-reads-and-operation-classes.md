# ADR-0028: Read cache, offline reads, and what works offline

- Status: Accepted
- Date: 2026-11-12
- Related: ADR-0020 (sales outbox), ADR-0027 (performance pass), QA-53 (offline catalog), QA-57 (offline shop name)

## Context

Every screen re-fetched everything on each visit (navigation felt slow), while in production
the service worker's default Serwist rule cached **every private `/api/*` GET for 24 h keyed by
URL only**. That rule could serve one shop's answers to the next shop signed in on the same
device while offline, and returned stale money/stock when the network was merely slow.

## Decision

1. **Service worker: the API is `NetworkOnly`.** The `apis` cache is deleted on activate.
   Pages, scripts and fonts keep their precache / runtime rules (the app shell loads offline).
2. **One read cache for the screens** (`client/shared/api/read-cache.ts`, `apiGet`):
   - memory answers per **shop + URL**, reused for 30 s (product list: 120 s);
   - **any successful write** to `/api/*` (POST/PUT/PATCH/DELETE through `fetch`) drops the
     whole memory cache in this tab and, via `BroadcastChannel`, in the other tabs — no stale
     balance or stock after a write; an answer that was in flight during a write is not kept;
   - the last good answer of read-only screens is kept in IndexedDB (`api_cache`, Dexie v5)
     **per shop** and used only when the request fails for lack of network (marked
     `x-hesba-source: offline`); error answers are never cached or replaced;
   - signing out (or the server refusing the session while online) clears memory and
     IndexedDB; auth, AI and sync endpoints are never cached.
3. **Server side:** route handlers stay dynamic (`force-dynamic`) — private tenant data is not
   cached by Next.js. `/api/sync/catalog` keeps `private, max-age=60` + ETag (shared catalog).

### Data categories

| Category | Strategy |
|---|---|
| Shared catalog | IndexedDB (`global_*`), cursor/ETag sync on sign-in and on reconnect (QA-53) |
| Shop identity (name, owner) | IndexedDB (`stores`, `sync_meta`), read offline (QA-57) |
| Shop products, stock, sales, people, alerts, home report, expenses, machines | read cache (memory 30–120 s, invalidated by writes) + offline copy per shop |
| Queued sales | outbox (ADR-0020), event-driven sync, `opId` idempotency |
| Session / user | never cached; session cookie only |
| AI | never cached; needs the network |

### What works offline

| Class | Operations |
|---|---|
| **Offline-supported** (queued in the outbox, synced on reconnect / tab visible / a tap on the sync bar, `opId` once-only) | a sale tapped on the Sales screen (stocked products; services not charged to a POS machine) |
| **Read-only cached** | products, stock, sales list, people (ليك/عليك/الموردين), alerts, home report, expenses, POS machines, shop name; the catalog search |
| **Requires network** (clear error, nothing recorded) | sign-up / login, product create/edit/delete, stock add / adjust / void, expenses, people create / payments / «سجّل عليه», cart checkout and credit sales (invoices), supplier purchases, services charged to a POS machine, promotions, sandwiches, AI assistant |

## Consequences

- Navigating between screens re-uses answers for up to 30 s unless something was written;
  changes made on another device appear within that window (or immediately after any write
  on this device).
- Offline, read-only screens show the shop's last saved answer; a screen never opened online
  says "مفيش نت، والصفحة دي لسه متحفظتش على الجهاز".
- Writes that need the server fail with a clear message offline; they are not queued (only
  sales have a server-side idempotent replay path today).
