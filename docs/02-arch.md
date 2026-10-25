# حسبة (Hesba) — Architecture: Software Design, Tech Stack & Folder Structure

> Consolidated architecture documentation combining:
> - **Part 1: Software Architecture** (formerly `docs/02-arch.md`)
> - **Part 2: Folder Structure & Boundaries** (formerly `docs/02-arch.md`)
> - **Part 3: Tech Stack** (formerly `docs/02-arch.md`)

---

# Part 1: Software Architecture
> Source: formerly `docs/02-arch.md`

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
  infra/        Repositories (SQL via Prisma) + external clients
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
(1) ORM: Prisma (ADR-0012) · (2) `change_log` Trigger or Repository · (3) Router inside `/app` · (4) Serwist and the update strategy · (5) SMS provider · (6) Hosting (05) · (7) Search library in Dexie · (8) Bulk-table manager.

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

---

# Part 2: Folder Structure
> Source: formerly `docs/02-arch.md`

> **A single package** (not a monorepo), a Next.js (App Router) app containing both the frontend and the server. **Antigravity:** creating folders/files outside this structure is forbidden without an ADR.
> ✱ = created in a specific phase (the number = the phase in 04-tasks.md).

---

## 1. The root

```
hesba/
├── src/
│   ├── app/                    # Next routes (App Router)
│   ├── client/                 # browser-only code
│   ├── server/                 # server-only code (server-only)
│   ├── domain/                 # pure shared logic (no DOM/Next/DB)
│   └── schemas/                # zod: the single source of types
├── prisma/                     # schema.prisma + SQL migrations (Expand/Contract)
├── data/catalog/               # CSVs for the public catalog + template.csv (06)
├── public/                     # manifest, icons, fonts/tajawal (local woff2)
├── scripts/                    # import-catalog.ts, seed.ts, check-env.ts, backup (05)
├── tests/                      # integration + e2e + security
├── docs/                       # 00..16 + demo/ (hesba-demo.html + src/) + adr/
├── .github/workflows/          # ci.yml, backup.yml, deploy-*.yml
├── Dockerfile                  # output: 'standalone' (Portability — built in CI)
├── docker-compose.dev.yml      # local postgres (+ minio if needed)
├── next.config.ts
├── prisma/schema.prisma
├── tsconfig.json
├── eslint.config.mjs           # import boundaries
├── package.json
├── AGENTS.md
├── .env.example                # dummy values only
└── README.md
```

---

## 2. `src/app` — Routes

```
src/app/
├── layout.tsx                  # root: html dir=rtl, font, theme
├── globals.css
├── (marketing)/                # Server-rendered
│   ├── page.tsx                # landing page ✱7
│   ├── pricing/page.tsx        ✱7
│   ├── terms/page.tsx
│   └── privacy/page.tsx
├── (auth)/                     # separate chunk
│   ├── signup/page.tsx         # two-step wizard: "عنك" (about you) / "محلك" (your store)
│   ├── login/page.tsx
│   ├── verify/page.tsx         # OTP
│   └── actions.ts              # Server Actions (signup, login, verifyOtp)
├── app/                        # the app (Client-only Shell)
│   ├── layout.tsx              # checks the session, then loads the Shell
│   └── [[...slug]]/page.tsx    # dynamic(() => import('@/client/app-shell'), { ssr:false })
├── admin/                      # admin panel ✱4+ (catalog, reports)
│   └── catalog/page.tsx
├── sw.ts                       # Service Worker (Serwist)
└── api/
    ├── sync/
    │   ├── push/route.ts       # POST
    │   ├── pull/route.ts       # GET (204 if nothing is new)
    │   └── catalog/route.ts    # public GET + ETag/Cache
    ├── cron/tick/route.ts      # the jobs (secret-protected)
    ├── webhooks/payments/route.ts ✱4
    └── health/route.ts
```

---

## 3. `src/client`

```
src/client/
├── app-shell/
│   ├── index.tsx               # Shell entry point
│   ├── router.tsx              # internal Router + lazy pages
│   ├── Shell.tsx  Header.tsx  BottomNav.tsx  SyncBar.tsx
│   └── providers/              # Theme, Auth, Sync, Toast
├── pages/
│   ├── home/HomePage.tsx
│   ├── products/ProductsPage.tsx          # + "اقتراحات" (Suggestions) tab
│   ├── stock/StockPage.tsx
│   ├── sales/SalesPage.tsx                # prefetch (most used)
│   ├── expenses/ExpensesPage.tsx
│   ├── people/PeoplePage.tsx
│   ├── alerts/AlertsPage.tsx              # + suggestion cards
│   └── ai/AiPage.tsx
├── features/
│   ├── sell-item/              # SellTile, WeightPopover, QuickQty, undo
│   ├── add-product/            # ProductFormModal + local matching against the catalog
│   ├── catalog-search/         # offline search in global_products
│   ├── suggestions/            # SuggestionCard: [إضافة] (Add) [مش محتاج] (Not needed) [بلّغ] (Report)
│   ├── add-stock/  add-expense/  manage-person/
│   ├── export-inventory/       # CSV (dynamic import)
│   ├── ai-chat/                # (dynamic import)
│   ├── profile/                # ProfileModal + the "مشاركة المنتجات المخصصة" (Share custom products) setting
│   └── review-rejected-ops/    # "محتاج مراجعة" (Needs review)
├── entities/
│   └── product/ batch/ sale/ person/ store/   { ui/, model/ }
└── shared/
    ├── ui/                     # Button, Field, SearchBox, Seg, Modal, Toast, Combobox, Chips, Stepper
    ├── styles/                 # tokens.css, themes.css, animations.css
    ├── hooks/                  # useGhost, useTheme, useOnline, useDebounce
    ├── lib/                    # format, uuid7, money
    ├── i18n/                   # ar.json
    ├── db/
    │   ├── dexie.ts            # tables + versions + migrations
    │   └── repositories/
    ├── sync/
    │   ├── engine.ts           # event-driven (no polling) + backoff/jitter
    │   ├── outbox.ts  apply-changes.ts  catalog-sync.ts  status.ts
    └── auth-client/            # session state + PIN lock
```

---

## 4. `src/server`

```
src/server/
├── config/env.ts               # zod for HESBA_* variables
├── platform/                   # logging, errors, audit, flags (maintenance), health
├── infra/
│   ├── db/
│   │   ├── client.ts           # Prisma + pooled URL
│   │   ├── tenant.ts           # withTenant(): set_config(app.store_id) inside tx
│   ├── storage/                # S3-compatible interface ✱
│   ├── sms/                    # interface + providers/*
│   ├── payments/               # interface + providers/*
│   └── llm/                    # interface + provider
└── modules/
    ├── auth/        { actions.ts, app/, domain/, infra/, index.ts }
    ├── tenancy/
    ├── catalog/
    │   ├── app/  { upsert-product, suggest-candidate, accept-suggestion, promote-candidate }
    │   ├── domain/ { match.ts, filters.ts }          # matching + automatic filters
    │   └── infra/  { products.repo, global-products.repo, candidates.repo, suggestions.repo }
    ├── inventory/   { domain/{fefo.ts,stock-level.ts}, app/, infra/ }
    ├── sales/       { domain/, app/{record-sale,void-sale}, infra/ }
    ├── expenses/  people/  alerts/
    ├── sync/        { handlers.ts (registry), push.ts, pull.ts, catalog.ts, infra/{sync-ops,change-log}.repo }
    ├── reports/
    ├── ai/          { tools/*.tool.ts, app/{ask,quota}, actions.ts }
    ├── billing/
    ├── jobs/        { queue.ts, tick.ts, handlers/*.job.ts }
    └── admin/
```

**Rules (enforced by ESLint boundaries):**
- `src/client` ❌ imports from `src/server`.
- `src/domain` and `src/schemas` ❌ import from `client`/`server`/Next.
- `domain/` inside a module ❌ imports from `infra/`.
- A module imports from another module through `index.ts` only.
- Every file in `src/server` starts with `import 'server-only'`.

---

## 5. `src/domain` and `src/schemas`

```
src/domain/
├── fefo.ts  units.ts  money.ts  stock-level.ts  totals.ts
├── normalize.ts            # Arabic normalization (06) + lots of tests
└── constants.ts            # limits (5 AI messages/day, suggestions cap, ...)

src/schemas/
├── product.ts  sale.ts  expense.ts  person.ts  catalog.ts
├── sync.ts                 # push/pull + ops + schema_v
└── index.ts
```

---

## 6. `prisma/`, `data/`, and `tests/`

```
prisma/
├── schema.prisma                  # models, relations, datasources
├── migrations/
│   └── 20261025000000_init/
│       └── migration.sql          # base tables, RLS policies, append-only grants, indexes

data/catalog/
├── template.csv                   # name, brand, size_value, size_unit, category, barcode, carton_qty, notes
└── seed-001.csv                   # first batch (double review)

tests/
├── integration/                   # Testcontainers
├── security/ { cross-tenant.spec.ts, no-store-identity-leak.spec.ts }
└── e2e/                           # Playwright: offline/sync/catalog
```

---

## 7. `docs/` and `.github/`

```
docs/
├── 01-SYSTEM-DESIGN.md  02-SOFTWARE-ARCHITECTURE.md  03-FOLDER-STRUCTURE.md
├── 04-tasks.md  05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md  06-CATALOG-AND-SUGGESTIONS.md
├── demo/hesba-demo.html           # the visual reference
├── adr/ { 0001-..., template.md }
└── runbooks/ { db-restore.md, maintenance-mode.md, move-hosting.md, move-database.md, rotate-secrets.md }

.github/workflows/
├── ci.yml        # lint + types + test + cross-tenant + build + docker build
├── backup.yml    # daily encrypted pg_dump to external storage (05)
└── deploy-*.yml  # depends on the chosen hosting
```

---

## 8. Naming rules
| Thing | Rule | Example |
|---|---|---|
| React Components | `PascalCase.tsx` | `SellTile.tsx` |
| Other files | `kebab-case.ts` | `record-sale.ts` |
| Hooks | `useXxx.ts` | `useGhost.ts` |
| Tests | next to the file as `*.test.ts` or in `tests/` | `fefo.test.ts` |
| DB tables | plural `snake_case` | `stock_movements` |
| DB columns | `snake_case` | `store_id` |
| IDs | uuid v7 | — |
| Env | `HESBA_*` defined in `config/env.ts` | `HESBA_DATABASE_URL` |
| Branches | `feat/…` `fix/…` | `feat/catalog-suggestions` |
| Commits | Conventional Commits | `feat(catalog): add suggestion accept` |

---

## 9. `AGENTS.md` (old draft — the actual version is at the package root)
> **The actual file is `AGENTS.md` at the root + `.agents/rules/`** (read by Antigravity). The draft below is for history only, and if they differ, the actual one wins.
```md
# Project rules
- Read AGENTS.md, then docs/00-index.md (the order), and all files in docs/ before any task. Work on one phase only at a time (from 04-tasks.md).
- A single Next.js app. No separate API. Server Actions for online flows, and /api/sync/* for sync only (reason in 02 section 2).
- Don't create files outside the structure in docs/03. If you need to, write an ADR.
- TypeScript strict. any is forbidden. Money is an integer in piasters.
- src/client doesn't import from src/server. Every file in src/server starts with import 'server-only'.
- Every table has store_id + RLS (except the public tables specified in 06). A new table without RLS = rejected.
- The UI doesn't wait for the server for any core operation: write to Dexie + Outbox. No periodic polling.
- Portability: provider-locked features are forbidden (Vercel KV/Blob/Edge Config). The Dockerfile must keep building.
- Prices and stock are never shared in catalog suggestions, and the store's identity never appears (06).
- Visual reference: docs/demo/hesba-demo.html. RTL, mobile-first (360px).
- After every task: run lint + typecheck + tests and report the result honestly.
- If unsure, ask. Don't invent numbers or prices.
```

## 10. Order of creating the structure
1. **Phase 1:** the root + `src/app` (health + empty Shell) + `src/schemas`/`domain` (basics) + CI + Dockerfile.
2. **Phase 2:** `auth` + `tenancy` + `sync` (skeleton) + `(auth)` + `shared/db` + `shared/sync`.
3. **Phase 3:** the eight pages + `catalog` (the public catalog and custom products), one by one.
4. **Phase 4+:** suggestions, reports, AI, payments, admin.

---

# Part 3: Tech Stack
> Source: formerly `docs/02-arch.md`

> The decision: **Full-stack TypeScript, a single Next.js app, Postgres, offline-first with Dexie.**
> The best choice is not "the newest thing"; it is the **fewest moving parts** for a small team + an AI Agent writing the code + a product that must work offline.
> **Versions:** We do not write version numbers here (they change). The Agent pins the latest stable version at creation time in `package.json` + the lockfile, and any major upgrade requires an ADR.

---

## 1. The Main Table

| Layer | Choice | Why | Rejected alternative (and why) |
|---|---|---|---|
| **Language** | TypeScript (strict) | One language for the UI and the server, shared types, the Agent is good at it | Plain JS (more errors) |
| **Framework** | **Next.js (App Router)** | One app (front end + server), Server Actions, Route Handlers, easy deployment | Vite + NestJS (two parts and more maintenance) |
| **UI** | React | Standard, the demo is written in it | Vue/Svelte (no reason to switch) |
| **Database** | **PostgreSQL** (Neon at first) | RLS to isolate shops, strong transactions for inventory, `pg_trgm` for search | MongoDB/Firebase (weak transactions, harder isolation), SQLite (multi-device sync is harder) |
| **ORM/Migrations** | **Prisma** (schema.prisma + migrations) | Declarative schema, type-safe client, RLS via raw SQL migrations and interactive transactions (ADR-0012) | Micro-ORMs without schema generators |
| **Local database** | **Dexie** (IndexedDB) | Source of truth on the phone, `useLiveQuery` | localStorage (small), SQLite-WASM (heavier, less mature) |
| **PWA / Service Worker** | **Serwist** (Workbox for Next) | Precache + Background Sync for App Router | next-pwa (unmaintained) |
| **Validation** | **zod** | A single source of types between client and server | Yup/Joi |
| **Sessions/Auth** | Simple custom: OTP + Argon2id (`@node-rs/argon2`) + httpOnly session cookie in the DB | Full control, same origin, no dependence on a provider | Auth0/Clerk (cost and vendor lock-in), Auth.js (complexity with OTP and devices) |
| **Styling (CSS)** | **CSS variables + CSS Modules**, ported from the demo | The demo is tested and polished; porting preserves quality instead of a rewrite | Tailwind (more familiar to the AI, but a rewrite loses design details) |
| **Components** | Our own components from the demo (Modal, Seg, Combobox...) | Tuned for RTL and mobile | Off-the-shelf libraries (mostly LTR and do not match the demo) |
| **State** | Dexie + `useState`; a small Zustand if needed | Domain data lives in Dexie only | Redux (overkill) |
| **Charts** | Custom SVG (like the demo's `BarChart`) | No library, smaller bundle | Chart.js/Recharts (heavy) |
| **i18n** | Simple JSON (`ar.json`) + a `t()` function | Arabic only in V1 | next-intl/i18next (overkill until we add a language) |
| **Dates** | `Intl` + small functions (like the demo) | No library | moment/dayjs |
| **Jobs** | A `jobs` table in Postgres + `/api/cron/tick` | No permanent Workers on free tiers/serverless | BullMQ/Redis (we move to it when measurements justify it) |
| **AI** | An LLM provider behind an interface + SQL tools | Numbers come from SQL, the LLM only phrases them; we can swap the provider | Relying on the LLM for calculation (hallucination) |
| **SMS** | A provider behind an interface (to be decided — ADR-0006) | OTP for sign-up only | — |
| **Subscriptions** | Manual renewal (Vodafone Cash & InstaPay) + WhatsApp confirmation (ADR-0008) | Activated manually by owner; no card data stored | Automated third-party billing (rejected in V1) |
| **Monitoring** | Sentry + structured logs (pino) | UI and server errors | — |
| **Testing** | Vitest + fast-check + Testcontainers + Playwright | Unit + property + real Postgres + offline | Jest (slower with ESM) |
| **Quality** | ESLint (+ boundaries) + Prettier + `tsc` | Import boundaries are enforced automatically | — |
| **Packages** | pnpm + Node LTS | Fast, strict lockfile | npm/yarn |
| **CI/CD** | GitHub Actions | Lint + Types + Tests + Docker build + backups | — |
| **Hosting** | Per `05` (Vercel Pro / Docker on a VM) + Neon | **Hobby is non-commercial** | — |
| **Domain/DNS/CDN** | Cloudflare | WAF + DNS + SSL | — |
| **Containers** | Docker (`output: 'standalone'`) | Portability + testing an exit from any provider | — |

## 2. Why Is This "The Best" for Hesba Specifically?
1. **Fewest moving parts:** One app + one Postgres. No Redis, no Workers, no separate API in V1. Every extra part is a maintenance burden for a small team.
2. **Offline is the foundation:** Dexie + Outbox + Service Worker are the heart of the product, not an add-on. The rest of the stack is chosen to serve that.
3. **Shop isolation in the database:** Postgres RLS protects even if the code has a bug.
4. **The AI Agent works better:** A single TypeScript + a fixed structure + zod as the source of types = fewer errors and easier review.
5. **No provider lock-in:** Everything external sits behind an interface, and Postgres/Docker/S3 are standard.
6. **Light on weak phones:** No heavy libraries, lazy chunks, SVG instead of Charts.

## 3. Explicit Constraints and Warnings
- **Vercel Hobby (the free tier) is non-commercial only** — `05` section 0. The stack itself is not locked to Vercel.
- **Next.js + offline:** App Router relies on RSC payloads; that is why the app after login is **Client-only** under `/app` (`02` section 3.1). Only the landing page is Server-rendered.
- **Server Actions are not suitable for sync** (their identifiers change with every Build, and they cannot be called from the Service Worker) → `/api/sync/*` (`02` section 2).
- **Serwist:** Confirm at creation time that it is maintained and compatible with the Next version you will pin (a verification task in Phase 1). If it is not compatible: an ADR and an alternative (a Service Worker written directly with Workbox).
- **Argon2 on serverless:** It consumes CPU. Measure the time and tune the parameters (`12`).
- **Neon free tier:** 1 GB storage, sleeps after idle, and only 6 hours of history → a dedicated backup (`05`).
- **Dexie on old devices:** Test on a weak Android. Browser storage limits vary (show them in Settings if we get close).
- **iOS:** Push notifications and PWA installation need different steps (test Safari). Push is not required in V1.

## 4. What We Will Not Use in V1 (a decision)
A separate NestJS/Express · Redis/BullMQ · Prisma · Tailwind · Redux · a Charts library · Firebase/Supabase Auth/Realtime · Vercel KV/Blob/Edge Config · GraphQL · tRPC · Microservices · WebSockets (sync is event-driven plus `pull`) · React Native/Flutter.
**Any exception = ADR.**

## 5. Dependency Policy
1. Every new dependency requires a written reason (in the PR or an ADR): What does it solve? Why don't we write it ourselves? Its size? Its maintenance?
2. The app's initial bundle is governed by a size budget in CI. A heavy dependency = dynamic `import()` or rejected.
3. `pnpm audit` + Dependabot in CI. A small weekly upgrade is better than a big jump.
4. No dependency locked to a provider (`05` section 6).
5. The lockfile is always committed. No `latest` in versions.

## 6. Environment Variables (names only)
```
HESBA_DATABASE_URL      # pooled (for the app)
HESBA_DIRECT_URL        # direct (for migrations)
HESBA_SESSION_SECRET
HESBA_CRON_SECRET       # protects /api/cron/tick
HESBA_SMS_PROVIDER / HESBA_SMS_KEY
HESBA_LLM_PROVIDER / HESBA_LLM_KEY
HESBA_CARD_KEY
HESBA_SENTRY_DSN
HESBA_STORAGE_*         # S3-compatible (if needed)
HESBA_APP_ORIGIN        # for Origin check
HESBA_RENEWAL_VODAFONE_CASH  # public: Vodafone Cash number shown to customers
HESBA_RENEWAL_INSTAPAY       # public: InstaPay address/number shown to customers
HESBA_RENEWAL_WHATSAPP       # public: WhatsApp contact number/link for renewal confirmation
```
Real values live in the Secret store (except public renewal details), and `.env.example` contains dummy values only. All of them are defined in `src/server/config/env.ts` with zod, and the app fails at startup if anything is missing.

## 7. When Do We Change the Stack? (by measurement)
| Symptom | Possible change |
|---|---|
| The cron tick is not enough | A standalone Worker or a real Queue (BullMQ+Redis or an alternative) |
| Sync becomes the heaviest part | Split it out as an independent Deployment (same code) |
| The single database reached its limit | Replicas, then Sharding by `store_id` (`01` Stage 5) |
| We need real Push | Web Push (VAPID) + iOS testing |
| We need the Play Store | A TWA/Capacitor wrapper around the same PWA |
| We need another language | `next-intl` or an alternative |

## 8. Verification Checkpoints at the Start of Phase 1 (the Agent records the result in `15`)
- [ ] The latest stable version of Next/React/Prisma/Dexie/Serwist and their compatibility.
- [ ] Serwist works with the current App Router (precache + offline navigation inside `/app`).
- [ ] `set_config(..., true)` works correctly on the pooled URL.
- [ ] Docker `standalone` builds and runs.
- [ ] Argon2 time on the chosen hosting is acceptable.
