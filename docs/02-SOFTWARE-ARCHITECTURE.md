# حسبة (Hesba) — Software Architecture (Next.js single-app version)

> **Update:** The project is now **a single Next.js app** (frontend + server in the same repo and the same origin). There is no NestJS, no `apps/api`, and no Redis/BullMQ in V1.
> Read 01 (System Design) first, then 05 (Hosting) and 06 (Catalog). If they conflict: 05 wins on hosting, 06 wins on the catalog, and this file wins on code details.
> Antigravity rules: don't write code outside the structure in 03, and don't invent a new library without an ADR.

---

## 1. What changed from the previous version

| Before | After | Reason |
|---|---|---|
| Separate NestJS API | Next.js: Server Components + Server Actions + Route Handlers | One app, one deployment, less maintenance |
| BullMQ + Redis Workers | `jobs` table in Postgres + `/api/cron/tick` | No always-on Workers on free/serverless hosts |
| JWT + Refresh in IndexedDB | **Session with an httpOnly cookie** (same origin) | Better security: no token in IndexedDB, and the Service Worker sends the cookie on its own |
| Monorepo (apps/packages) | **Single package** + `src/{client,server,domain}` | Simpler |
| Cloudflare/Docker as givens | **Portable:** Vercel or Docker (`standalone`) — 05 | Easy to move |

---

## 2. The key decision: Server Actions or Route Handlers?

**The rule:** everything that **only works online** goes to Server Actions / Server Components. **Offline operations (sync) go to fixed Route Handlers.**

| Operation type | Tool | Why |
|---|---|---|
| Sign-up/login/OTP, profile, subscription and payment, AI question, admin screens | **Server Actions** | Online by nature; simplest code and built-in security |
| Reading reports and the home screen | **Server Components** (or a Server Action) | They read straight from the DB |
| **`sync push/pull/catalog`** | **Route Handlers** (`/api/sync/*`) | **Reason below** |
| Cron/Jobs | Secret-protected Route Handler | Called from an external scheduler |
| Payment webhooks | Route Handler | The gateway calls a fixed URL |

**Why isn't sync done with Server Actions?** (This isn't stubbornness; these are technical constraints.)
1. The **Service Worker / Background Sync** can't call a Server Action (it is tied to an open React page).
2. Server Action IDs **change with every build**, and a device may have an old version cached offline along with a queue of operations; after a deploy, the old call may fail.
3. Sync needs a **fixed, versioned API contract** (`/api/sync/push` + `schema_v`) that supports two consecutive app versions.
4. It needs full control over `status codes` (`503 + Retry-After` for soft maintenance mode, `429`, `204`).

> This isn't a "separate API": it is just two `route.ts` files inside the same app and the same deployment.

---

## 3. The frontend

### 3.1 App split (important for offline)
| Part | Approach | Notes |
|---|---|---|
| **Landing page / pricing / terms** | Plain server-rendered (SEO) | `app/(marketing)` |
| **Sign-up and login** | Plain Next pages + Server Actions | `app/(auth)` — separate bundle |
| **The app itself (after login)** | **Client-only Shell** under `/app/*` | `app/app/[[...slug]]/page.tsx` with `dynamic(..., {ssr:false})` and an internal Router inside (React Router or similar) |

**Why is the app client-only?** App Router navigation depends on RSC payloads from the server, and that is **fragile offline**. If all app screens are Client Components reading from Dexie, navigating between the eight pages is guaranteed to work with no network. This extends the "single page with a Shell" decision: Header + Bottom Nav stay fixed, the content changes, every page is a `lazy` chunk, and the sell screen is preloaded up front.

- **PWA/Service Worker:** `Serwist` (Workbox for the Next App Router) — Precache for the shell and all chunks, **ADR-0005** for the update strategy + Kill switch.
- Performance budget: the initial bundle size is set after the first build, and CI fails if it grows.
- RTL, mobile-first (360px), colors from the demo (`#EFE8D6`/`#4F6B46`, local Tajawal), light/dark/auto theme.

### 3.2 Code layers (`src/client`)
```
src/client/
  app-shell/   Shell, Header, BottomNav, SyncBar, router
  pages/       one screen per Route (composes features)
  features/    sell-item, add-stock, add-product, add-expense, suggestions, ...
  entities/    product, batch, sale, person, store
  shared/      ui, hooks, lib, i18n, db (Dexie), sync (engine), auth-client
```
**Import rule (ESLint):** `pages → features → entities → shared`. And `src/client` is **forbidden** from importing from `src/server` (we also add `client-only`/`server-only` as a safeguard).

### 3.3 Data and state
| Type | Tool |
|---|---|
| Domain data (products, sales, ...) | **Dexie** + `useLiveQuery` (source of truth on mobile) |
| Public catalog | Dexie (read-only, incremental update) — 06 |
| Temporary UI state | `useState`/small Zustand |
| Online-only data (subscription, invoices) | Server Actions + TanStack Query or Server Components |

**The golden rule:** the UI **never waits for the server** for any core operation: write to Dexie → update the screen → add an operation to the Outbox.

### 3.4 Sale flow
```
1) User taps "بيع" (Sell)
2) domain.sell(state, input)  ← the same shared function in src/domain (FEFO + total)
3) One Dexie transaction: sale + lines + stock_movements + op in outbox {op_id: uuidv7, type:'sale.create', schema_v}
4) The screen updates immediately (useLiveQuery)
5) SyncEngine sends once the conditions are met (section 3.5)
6) The server replies applied/duplicate/rejected
7) Pull fetches any corrections
```
**Undo = a new reverse operation (`sale.void`)** that uses the recorded `takes`, not a delete.

### 3.5 Sync Engine (event-driven, **no polling**)
```
When it runs: (1) after the last local write with a 5–10 second debounce (2) app open (3) network back
              (4) tab returns to the foreground (5) the "زامن دلوقتي" (Sync now) button   ← periodic setInterval is forbidden
Loop: batch the oldest N pending operations (sales first) → POST /api/sync/push → mark the results
      → GET /api/sync/pull?cursor= until has_more=false (204 if nothing new)
On failure: exponential backoff + jitter; 503 + Retry-After = "the server is updating, your work is saved"
401: show "سجّل دخولك" (Log in) but **don't stop local selling**; the queue waits
```
The reason: polling wakes the database and eats the free tier (05 section 3).

### 3.6 UI components
Button, Field, SearchBox, Seg (animated thumb), Modal/Sheet (ghost exit), Toast, Combobox, Chips, Stepper (from the demo) in `shared/ui`. Accessibility: focus, targets ≥44px, `prefers-reduced-motion`.

---

## 4. The server (inside the same Next app) — `src/server`

### 4.1 Layers in each Module
```
src/server/modules/<module>/
  actions.ts    Server Actions (check the session and call a use-case)  — if there is an online flow
  handlers.ts   handlers for Sync operations (op type → handler)
  app/          Use-cases (one Transaction, a verb: RecordSale, AddStock, VoidSale)
  domain/       pure rules (no Next/DB) — or shared from src/domain
  infra/        Repositories (SQL via Drizzle) + external clients
  index.ts      the module's only Public API
```
**Rules:**
1. `domain` doesn't import from `infra` or from Next.
2. A module doesn't read another module's tables — it calls that module's Public API.
3. Server Actions and Route Handlers are **thin**: validation (zod) + session + use-case + response.
4. Every file in `src/server` starts with `import 'server-only'`.

### 4.2 The modules
| Module | Responsibility |
|---|---|
| `auth` | OTP, password (Argon2id), sessions, devices |
| `tenancy` | Stores, members, the active subscription, setting `store_id` for the DB |
| `catalog` | Store products + the public catalog + filters and suggestions (06) |
| `inventory` | Batches, movements, FEFO, balance, waste |
| `sales` | Invoices, void, accounting |
| `expenses`, `people` | Expenses / customers-suppliers-workers + credit (deferred payment) |
| `alerts` | Alert calculation + suggestions for the store |
| `sync` | push/pull/catalog + `change_log` + registry |
| `reports` | Reading `daily_store_stats` |
| `ai` | The assistant (SQL tools) + 5/day limit |
| `billing` | Plans, subscriptions, Webhooks |
| `jobs` | A simple queue in Postgres + tick |
| `platform` | health, config (zod), feature flags, audit |
| `admin` | Admin panel (catalog, reports) — later |

### 4.3 Sessions and security (same origin)
- Password: **Argon2id** (tuned parameters because CPU is limited on serverless; measure the time and adjust). OTP with limits per number/IP/device.
- **Session cookie:** `httpOnly; Secure; SameSite=Lax`, rotating (Rotation), bound to a device (`device_id`), with `sessions` stored in the DB (revocable from the server).
- `/api/sync/*` checks: the session + a matching `Origin` + the `X-Hesba-Client` header (CSRF protection) + `schema_v`.
- **Offline and the session expired:** the app keeps selling locally; verification happens at sync time.
- Optional local PIN lock.
- Everything is `server-only`; secrets live only in environment variables.

### 4.4 Multi-tenancy and RLS (with Serverless Pooling)
```ts
// src/server/infra/db/tenant.ts
export async function withTenant<T>(storeId: string, userId: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`); // true = local to the transaction
    await tx.execute(sql`select set_config('app.user_id',  ${userId},  true)`);
    return fn(tx);
  });
}
```
- `set_config(..., true)` works correctly with Pooling in Transaction mode (important for Neon/PgBouncer) ✔ — **actually test it** in CI.
- The app's DB user is **not a superuser and has no `BYPASSRLS`**; Migrations run under a different user. `DATABASE_URL` (pooled) is for the app, and `DIRECT_URL` is for migrations.
- **A Cross-tenant test is mandatory in CI** on every Endpoint/Action/Handler.
- Public tables (`global_products`, `plans`) are read-only for the app, and are written from the server/admin under a separate role.

### 4.5 Sync on the server (Route Handlers)
```ts
// src/app/api/sync/push/route.ts  (abridged)
export async function POST(req: Request) {
  const session = await requireSession(req);              // cookie + Origin + X-Hesba-Client
  if (await maintenanceMode()) return new Response(null, { status: 503, headers: { 'Retry-After': '120' } });
  const body = pushSchema.parse(await req.json());       // zod from src/schemas
  const results = [];
  for (const op of body.ops) {                           // in order
    results.push(await withTenant(session.storeId, session.userId, async (tx) => {
      const seen = await syncOps.find(tx, op.op_id);
      if (seen) return { op_id: op.op_id, status: 'duplicate' };
      const h = registry[op.type]; if (!h) return reject(op, 'unknown_type');
      const p = h.schema.safeParse(op.payload); if (!p.success) return reject(op, 'invalid');
      const out = await h.handle({ tx, ...session }, p.data);
      await syncOps.insert(tx, op.op_id, out);            // + change_log inside the same tx
      return { op_id: op.op_id, status: 'applied', ref: out };
    }));
  }
  return Response.json({ results });
}
```
- **Each operation is its own Transaction:** one failing doesn't take down the rest.
- **pull:** `change_log` with a `cursor`, and `204` if nothing is new.
- **catalog:** `/api/sync/catalog?cursor=` (public, long Cache + ETag).
- **Time/size limit:** a maximum number of operations per request (based on the Function timeout — ❓ confirm on the chosen host).
- **Conflict rules** (from 01): LWW for core data, stock movements never conflict, a negative balance is accepted and flagged, delete wins.
- Versions: `schema_v`, and the handler supports the current and the previous one.

### 4.6 FEFO (the heart of inventory) — same logic as before
```
sell(productId, qtyBase):
  batches = SELECT ... remaining>0 ORDER BY expiry_date NULLS LAST, received_at FOR UPDATE
  takes = []; need = qty
  for b in batches: t=min(b.remaining,need); takes.push({batch:b.id,qty:t}); need-=t
  if need>0: takes.push({batch:null, qty:need, negative:true})   // negative is flagged
  for each take → stock_movements(type='sale', qty=-t, batch_id, sale_line_id)
  sale_lines.takes = takes  // for an exact void
```
- Everything is internally in the **base unit** + `product_units` for conversion. **Money is an integer in piasters** (Float is forbidden).
- The function is written once in `src/domain/fefo.ts` and shared (mobile for display, the server is the judge).
- Property-based tests: sum of movements = balance · void then sale = same state · FEFO ordering.

### 4.7 Jobs without Workers
```
jobs table (id, type, payload, run_at, attempts, status, locked_until, last_error)
POST /api/cron/tick  (secret-protected)  ←  called from a scheduler (Vercel Cron, an external one, or GitHub Actions)
  → SELECT ... WHERE status='pending' AND run_at<=now() ORDER BY run_at LIMIT N
    FOR UPDATE SKIP LOCKED  → run a small batch → update the status
```
- Every job is **idempotent** + retries with backoff + a maximum number of attempts + a Dead status + a review panel.
- Uses: sending SMS, aggregating `daily_store_stats`, choosing stores for suggestions (06), payment reconciliation, archiving.
- If Cron is limited (❓ 05): we batch more in each tick or use a free external scheduler.
- **If the load grows** (Stage 3+): we move the tick to a standalone Worker or add a real queue — a decision based on measurement (01).

### 4.8 Reports and AI
- `daily_store_stats` is updated by a job; the home screen reads from it + the last few hours from raw data for the current day.
- **The AI:** all numbers come from predefined **read-only SQL tools** (`top_products`, `profit_by_period`, `expiring_soon`...). The LLM understands the question and words the answer from the result only; it **doesn't calculate or make things up**. A 5/day limit via an atomic check (`INSERT ... ON CONFLICT ... WHERE count < 5`), a Timeout, and a Fallback to a rule-based answer.

### 4.9 Catalog and suggestions
Full details are in **06-CATALOG-AND-SUGGESTIONS.md** (tables, flows, filters, notifications, privacy protection).

---

## 5. Contracts (examples)

```json
POST /api/sync/push   (Cookie + X-Hesba-Client + Origin)
{ "device_id":"...", "schema_v":1,
  "ops":[ { "op_id":"018f...", "type":"sale.create", "client_ts":"2026-10-15T10:21:00+03:00",
            "payload":{ "sale_id":"018f...", "lines":[ { "product_id":"...", "unit":"carton", "qty":2, "price_minor":12500 } ] } } ] }
→ 200 { "results":[ { "op_id":"018f...", "status":"applied" } ] }
→ 503 + Retry-After   (soft maintenance mode — 05 section 5)

GET /api/sync/pull?cursor=1042&limit=500
→ { "changes":[{ "seq":1043,"entity":"product","id":"...","op":"upsert","data":{...} }], "next_cursor":1043, "has_more":false }
→ 204 if nothing is new
```
Unified error shape: `{ "error": { "code", "message", "details", "request_id" } }`. `/api/sync/*` is fixed and versioned; no breaking change without a new version.

---

## 6. Resilience
- Domain errors → 4xx · Infra errors → 5xx + Sentry.
- Timeouts + Retries + Circuit Breaker for any external service (SMS/payment/LLM).
- `/api/health` (live/ready: DB).
- **Maintenance flag** in the DB (`flags`) → Sync replies 503 (for zero-downtime migration, 05).
- Dead jobs + review.

## 7. Testing
| Level | Tool |
|---|---|
| Unit (domain: FEFO, units, Arabic normalization) | Vitest |
| Property-based (stock, void, idempotency) | fast-check |
| Integration (Handlers/Actions + real Postgres + RLS) | Vitest + Testcontainers |
| Contract | Shared zod schemas (`src/schemas`) |
| E2E (sign-up → offline sale → sync → catalog suggestion) | Playwright |
| Offline chaos (cut mid-push, duplicate op, two devices) | Playwright |
| Load (sync storm) | k6 |
| Security (Cross-tenant, no store identity leak, audit) | CI |

**Merge condition:** Lint + Types + Unit + Integration + Cross-tenant + Build (+ Docker build to confirm Portability).

## 8. ADRs required before code
> The status-updated list is in `15-DECISIONS-AND-OPEN-QUESTIONS.md` section 6.
(1) ORM: Drizzle · (2) `change_log` Trigger or Repository · (3) Router inside `/app` · (4) Serwist and the update strategy · (5) SMS provider · (6) Hosting (05) · (7) Search library in Dexie · (8) Bulk-table manager.

## 9. Code rules (Antigravity and the team)
1. TypeScript `strict`, `any` is forbidden.
2. The schemas (zod) in `src/schemas` are the single source of Types.
3. **Money:** integer in piasters. **Dates:** UTC in the DB, displayed in Cairo time.
4. No `SELECT *`, no N+1, and a hot query gets an `EXPLAIN`.
5. Migrations: Expand/Contract, and don't drop a column in the same Release.
6. Any visible text goes in an i18n file (Arabic first).
7. **Portability (05 section 6):** Vercel KV/Blob/Edge Config or any provider-locked feature is forbidden, unless behind an interface.
8. **No periodic polling** in the client (it eats the free tier).
9. No secrets in code and no personal data in logs.
10. Small PRs with Tests. If unsure: ask or write an ADR.

## 10. Out of scope in V1
Online store · Advanced multi-branch · Hardware (printers/barcode scanners) unless the need is confirmed · Microservices · Native app · Full CRDTs · Product images.
