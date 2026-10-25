# حسبة (Hesba) — Product: Brief, System Design, Roadmap & Decisions

> Consolidated product documentation combining:
> - **Part 1: Product Brief** (formerly `docs/01-product.md`)
> - **Part 2: High-Level System Design** (formerly `docs/01-product.md`)
> - **Part 3: Roadmap & Evolution** (formerly `docs/01-product.md`)
> - **Part 4: Decisions and Open Questions** (formerly `docs/01-product.md`)

---

# Part 1: Product Brief (Vision and Scope)
> Source: formerly `docs/01-product.md`

> Read this file first. It defines "what we are building and what we are not building." Any feature not listed here is not in V1.

---

## 1. The Idea
**Hesba (حسبة)** is a very simple mobile app for the owner of a supermarket or small shop in Egypt. The owner records sales, inventory, expenses, and the money owed to them and by them, and can see their profit, what is running low, and what is close to expiry, with no complexity and no training.

**The promise:** "Open, sell, know your numbers." In as few steps as possible.

## 2. Users
| User | What they do | Core need |
|---|---|---|
| **Shop owner** (primary user) | Sells, buys stock, reviews the books | To see profit and inventory quickly, without a computer |
| **Worker/cashier** (permissions in V1.1) | Sells only | A fast sales screen with no room for mistakes |
| **You/Admin** (platform admin) | Reviews the catalog and reports | Simple control tools |

**Context:** Fully mobile use, intermittent internet, varying technical skill, a wide range of Android devices (some of them weak).

## 3. Product Principles (in priority order)
1. **Simplicity above everything.** Any feature that adds a step or clutter is postponed or removed.
2. **Selling never stops.** No internet, no server, no valid session: selling continues.
3. **The numbers must be right.** Wrong stock or money means lost trust. Correct matters more than fast.
4. **Simple Egyptian Arabic.** Short sentences, no accounting jargon.
5. **Mobile first.** No screen is designed for a desktop computer.
6. **Nothing crowded.** Enough whitespace, smooth motion, one thing per screen.
7. **Shop privacy.** The shop's data (prices, inventory, sales) belongs to it and is never shared.

## 4. V1 Scope (the eight pages)
| Page | Function | Notes from the demo |
|---|---|---|
| **Home (الرئيسية)** | Period summary: sales, profit, expenses, chart (hourly if a single day) | Periods: today/week/month/custom |
| **Products (المنتجات)** | List + search + add/edit a product (piece/weight, carton, prices) | + custom products + suggestions (06) |
| **Inventory (المخزون)** | Add stock (batches, expiry, supplier, paid/on credit) + additions log + waste | FEFO |
| **Sell (البيع)** | Fast screen: tiles, weight, carton, Undo | The most used |
| **Expenses (المصروفات)** | Record an expense by category (electricity/internet/rent/salaries/transport/maintenance/other) | Buying stock is recorded in Inventory, not here |
| **People (الناس)** | Owed to you (someone owes you money) / You owe (you are in debt) / Suppliers | No complex account statement in V1 |
| **Alerts (التنبيهات)** | Out of stock / running low / near expiry (≤ 7 days) + suggestions | Counter badge on the nav icon |
| **AI** | Assistant that answers questions about the shop (5 messages/day) | Numbers from SQL only |

**Alongside:** Sign-up (two steps) + login + shop profile + theme (light/dark/auto) + subscription and payment + sync and offline.

### Intentionally removed from the demo
- **Floating (+) button:** Removed because it adds clutter and duplication (every page already has its own add action). It will not come back without usage data proving the need.

## 5. Out of Scope in V1 (V2 and later — `14`)
Online store · multiple branches · invoice printing/printers · barcode scanner (candidate for V1.1) · multi-item cart in one invoice (candidate for V1.1) · detailed worker permissions (V1.1) · product images · integration with the government e-invoice system (needs legal review) · native app.

## 6. The Shared Catalog (our differentiating feature)
- A public catalog of common products (we prepare it manually because there is no API).
- A shop adds a custom product, and suitable shops get a prompt: "There is a product X, add it? [Add]". Details and privacy are in `06`.

## 7. Glossary
| Term | Meaning |
|---|---|
| **Batch (دفعة)** | A quantity purchased at one time with a specific expiry date and cost |
| **FEFO** | First-Expired, First-Out: sell from the nearest expiry first |
| **Base unit (وحدة أساسية)** | Piece for regular products, gram for weighed products |
| **Carton (كرتونة) (Pack)** | A fixed number of pieces (for example 12) at a carton price |
| **On credit (آجل)** | Money not yet paid (owed to you or by you) |
| **Outbox** | The queue of local operations not yet sent to the server |
| **op_id** | A unique identifier for each operation that guarantees it executes exactly once |
| **Sync** | Synchronizing operations between the phone and the server |
| **RLS** | Isolating each shop's data at the database level |
| **Custom product (منتج مخصص)** | A product the shop added itself (not from the public catalog) |
| **Candidate (مرشّح)** | A custom product that has been turned into a suggestion for other shops |

## 8. Tone of Voice (Copy)
- Simple, short Egyptian colloquial Arabic: "اتسجل" (Saved), "مفيش منتجات" (No products), "تضيفه عندك؟" (Add it to your shop?).
- Errors in a calm tone that states the fix: "اكتب المبلغ" (Enter the amount), "النت واقع، شغلك محفوظ" (The internet is down, your work is saved).
- No jargon: instead of "Reconciliation" → "راجع الحساب" (Review the account).
- Numbers: currency "ج.م" (EGP), Latin digits (or Arabic-Indic via a setting), consistent across the whole app.
- **No unproven marketing claims** (like "free" or "the fastest") in any text.

## 9. Visual Identity (from the demo)
Beige background `#EFE8D6` · green `#4F6B46` · **Tajawal** font (local, not from Google) · light/dark/auto theme · rounded corners · smooth motion. Details are in `11-UI-UX-SPEC.md`. The logo is at `docs/demo/logo.png`.

## 10. Success Metrics (numbers are set in Phase 0)
| Phase | Metric | Target |
|---|---|---|
| Alpha | Days of use per week per shop | (from P0-PR-03) |
| Alpha | Sales operations per shop per day | (from P0-PR-03) |
| Alpha | Data loss | **Zero** |
| Beta | Weekly retention | (set after Alpha) |
| Suggestions | Suggestion acceptance rate | (set after the first wave) |
**The numbers are intentionally blank.** We do not write a target before we see reality.

## 11. Assumptions That Must Be Verified (recorded in `15`)
- That the shop owner will use the phone for actual selling (not just for review).
- That "one-tap sale per item" is enough in V1 (without a cart).
- That the shared catalog will noticeably reduce the time it takes to add products.
- That shops will accept sharing product definitions anonymously.

---

# Part 2: High-Level System Design
> Source: formerly `docs/01-product.md`

> This file is the reference for Antigravity and the team. It explains **what will be built, why, and what changes at each growth stage**.
> Every number in this file is an **assumption** until it is measured in Alpha/Beta. The rule: **measurement beats estimation**.
> There are deliberately no prices here — prices are calculated from real provider quotes.
>
> **Update (single Next.js app):** The server now lives inside one Next app (02). Free hosting and the upgrade path are in **05**, and the shared catalog is in **06**. Every mention of NestJS/Redis/BullMQ/Workers in this file has been either revised or deferred to a higher Stage, to be decided by measurement.

---

## 0. Summary in 10 lines

1. The product: a mobile PWA that is **offline-first**, with the server as the source of truth.
2. The UI writes to IndexedDB and puts every operation into a queue (Outbox) with a unique `op_id`.
3. When the network returns: `POST /api/sync/push` (idempotent), then `GET /api/sync/pull?cursor=` .
4. The server: **one Next.js app** (Server Actions for online-only work + Route Handlers for sync) with internal modules — not Microservices and not a separate API.
5. Database: PostgreSQL 16, every table has `store_id` + Row-Level Security.
6. Inventory = an **append-only movement log** (batches + movements), not a number that gets edited.
7. Reports are read from daily aggregate tables (`daily_store_stats`), not from millions of raw rows.
8. Background jobs (SMS, report aggregation, suggestions) live in a Postgres `jobs` table + `/api/cron/tick` (a real Queue later, driven by measurement).
9. We scale in stages (Stages 0→5), and moving between them is driven by **measurement indicators**, not by customer count alone.
10. Each stage lists: what will break, how we detect it, and the ready-made fix.

---

## 1. Goals and constraints

### Functional goals (V1)
Products, inventory (batches and expiry dates), selling (carton/weight/piece), expenses, people (customers/suppliers/workers), alerts, AI assistant (5 messages/day), home screen and reports.

### Non-functional goals (design targets — confirmed by measurement)
| Aspect | Target |
|---|---|
| Selling without internet | 100% working (no step depends on the server) |
| Time to record a sale on the mobile | Instant and local (never waits for the network) |
| API response time (p95) | Initial target ≤ 300ms for reads, ≤ 500ms for writes (adjusted after measurement) |
| Availability | Target 99.5% in the first year (improves with budget) |
| Data loss | RPO ≤ 5 minutes, RTO ≤ 2 hours |
| Security | Full isolation between stores; no access to one store's data from another store |
| Simplicity | Any feature that conflicts with "simplicity above everything" (البساطة فوق كل حاجة) is postponed |

### Constraints
- Small team (start with one or two people) → the simplest architecture that is enough.
- Stores' internet connections are weak and intermittent → offline is not a feature, it is the foundation.
- Personal data (Law 151/2020) → the legal decision on hosting is taken with a lawyer **before** production.

---

## 2. Load assumptions (must be reviewed after Alpha)

> Every number here is an **assumption for calculation only**. A "Measured?" column sits next to it; replace the value with the real number from Alpha.

| Variable | Default value | Measured? |
|---|---|---|
| Average sales per day per store `S` | 150 | ☐ |
| Average items per invoice `L` | 3 | ☐ |
| Active devices (mobiles) per store `D` | 2 | ☐ |
| Actual working hours per day `H` | 10 | ☐ |
| Peak factor `K` (peak ÷ average) | 3 | ☐ |
| DB row size including indexes `B` | 250 bytes | ☐ |
| Number of products per store `P` (small / supermarket) | 300 / 5,000 | ☐ |

### Formulas (use them with any numbers)
```
sales operations/day     = stores × S
new rows/operation     = 1 (sale) + L (lines) + L (stock_movements) + 1 (change_log)
rows/day                = sales operations/day × (2L + 2)
sale writes/second (avg) = sales operations/day ÷ (H × 3600)
sale writes/second (peak)= average × K
storage growth/day      = rows/day × B
```

### Stage table with the default numbers (S=150, L=3, H=10, K=3, B=250)
| Stores | Sales/day | Rows/day (×8) | Avg sales/s | Peak sales/s | Approx. storage/day |
|---|---|---|---|---|---|
| 10 | 1,500 | 12,000 | 0.04 | 0.12 | ~3 MB |
| 100 | 15,000 | 120,000 | 0.4 | 1.25 | ~30 MB |
| 500 | 75,000 | 600,000 | 2.1 | 6.3 | ~150 MB |
| 1,000 | 150,000 | 1.2 M | 4.2 | 12.5 | ~300 MB |
| 3,000 | 450,000 | 3.6 M | 12.5 | 37.5 | ~0.9 GB |
| 5,000 | 750,000 | 6 M | 21 | 62.5 | ~1.5 GB |
| 10,000 | 1.5 M | 12 M | 42 | 125 | ~3 GB |

**Reading the table:** Live writes (125 writes/second at peak with 10,000 stores) are a **modest** number for PostgreSQL on a suitable server.
The real problem at 10,000 is not QPS; it is **data volume (≈ 1 TB/year)**, **reports**, and **sync storms** (section 7).
If the real numbers are much higher than the assumptions → this table is recalculated and the stages move earlier.

---

## 3. High-level architecture

```
┌──────────── Mobile (PWA) ──────────────┐
│ React UI ─ Dexie(IndexedDB) ─ Outbox   │  ←  works offline
│ Service Worker (Workbox): cache + sync │
└───────────────┬────────────────────────┘
                │ HTTPS (when network returns)
        ┌───────▼────────┐
        │ Cloudflare     │  DNS · WAF · CDN · Rate limit
        └───────┬────────┘
        ┌───────▼─────────────────────────────┐
        │ Next.js (single app)                │
        │ Actions · /api/sync · /api/cron     │
        └──┬───────────┬──────────────┬───────┘
           │           │              │
   ┌───────▼───┐ ┌─────▼──────┐ ┌─────▼────────┐
   │PostgreSQL │ │ jobs (PG)  │ │ S3-compatible│
   │ 16 + RLS  │ │ cron tick  │ │ files/backups│
   └───────────┘ └─────┬──────┘ └──────────────┘
                       │ jobs
        ┌──────────────▼───────────────┐
        │ SMS · LLM                    │
        └──────────────────────────────┘
```

### Why Monolith and not Microservices?
| | Modular Monolith (our choice) | Microservices |
|---|---|---|
| Operational complexity | Low | High (network, deployment, monitoring per service) |
| Small team | Suitable | Exhausting |
| Single DB transaction (sale + inventory) | Simple and safe | Distributed transactions = risk |
| Splitting later | Possible because the modules are isolated | — |
**Rule:** Modules talk to each other through defined interfaces, and there is **no** direct query across tables of two different modules. This is what makes separating them later cheap.

**When do we split out a service?** (When this happens, by measurement): the AI consumes CPU/memory or is slow → a separate service · the Workers compete with the API → a separate Deployment · Sync becomes the heaviest load → separate it from the Core API. (Before that: no.)

---

## 4. Data design (principles that affect growth)

1. **Every table has `store_id`** + an RLS policy: `USING (store_id = current_setting('app.store_id')::uuid)`.
2. **UUID v7** for IDs (time-ordered → faster indexes than v4), generated on the mobile (important for offline).
3. **Inventory = movements:** `batches` (a batch: quantity, expiry date, cost) + `stock_movements` (append-only: +purchase, −sale, −waste, ±adjustment). Balance = sum of the movements (with a cached `stock_levels` that is updated with every movement).
4. **FEFO selling:** The server consumes from the nearest expiry and records `takes` so that undo restores exactly to the same batches.
5. **Soft delete** (`deleted_at`) because sync needs to carry deletions.
6. **Every row that changes** writes a line to `change_log (store_id, seq, entity, entity_id, op, ts)`. The pull walks along `seq`.
7. **`sync_ops(op_id UNIQUE)`**: this guarantees that the same operation is not executed twice.
8. **Aggregate tables for reports:** `daily_store_stats(store_id, day, sales_total, sales_count, cogs, expenses, waste, ...)` + `hourly` if needed. The Worker updates them, and the home screen reads from them.
9. **Partitioning:** `sales`, `sale_lines`, `stock_movements`, `change_log` are large tables → partition by month (`created_at`) from Stage 3.
10. **Time:** We store `client_ts` (from the device, for display) and `server_ts` (for ordering). **No core logic depends on the device clock.**

### Main tables (brief — details in 02)
`stores, users, store_members, devices, products, product_units, batches, stock_movements, sales, sale_lines, expenses, waste_records, people, person_txns, change_log, sync_ops, alerts_state, subscriptions, ai_usage, audit_log, daily_store_stats`.

---

## 5. Sync design (the heart of the system)

### Push (from the mobile)
```
POST /api/sync/push
{ device_id, ops: [ {op_id, type, payload, client_ts, seq}, ... ] }   // batches ≤ N operations

For each op (in order, inside one Transaction per op):
  1) If op_id exists in sync_ops  → status="duplicate" (same old result, no execution)
  2) validate (zod) + permissions + active subscription
  3) Run the domain logic (e.g. sale: FEFO + movements)
  4) Write sync_ops + change_log
  5) status="applied" or "rejected"(reason)
Response: [{op_id, status, server_refs?}]
```

### Pull (to the mobile)
```
GET /api/sync/pull?cursor=<seq>&limit=500
→ { changes:[{entity, id, op, data, seq}], next_cursor, has_more }
```
The mobile applies the changes in Dexie and saves the `cursor`.

### Conflict resolution rules
| Case | Rule |
|---|---|
| Editing core data (product name/price) | Last write wins (LWW) by `server_ts` |
| Inventory movements | **No conflict**: every movement is a new row |
| Selling a product whose balance is 0 on the server | **Accepted**; the balance may go negative and gets a Flag and an alert (the sale actually happened in the real world, so we cannot reject it) |
| Delete on one device and edit on another | The delete wins, and the edit is recorded in the log |
| Rejected operation (validation) | Marked `rejected` and shown to the user under "needs review" (محتاج مراجعة) instead of getting lost |

### Sync failure modes (possibilities)
| Case | Solution |
|---|---|
| The network drops in the middle of a request | Retry is safe (idempotent) |
| Very large Outbox queue (a store stayed days without internet) | Small batches + visible progress + priority for sales operations |
| Device wiped/changed | Full Pull from `cursor=0` after login (or a snapshot) |
| An operation that always fails | After X attempts → `quarantined` + notification + no blocking of the rest of the queue |
| An old app version sending an old operation shape | Versioning: `schema_v` in every operation + the server translates the older one or asks for an update |

---

## 6. Growth stages — Stage 0 → Stage 5 (the core of this file)

> **Transition rule:** We do not move to a higher Stage because the count was reached; we move when an **indicator** exceeds its limit for 3 consecutive days (or is expected to exceed it within a month).

### Measurement indicators (the Dashboard must be ready from Stage 1)
`p95/p99 latency` · `error rate` · `DB CPU/IO` · `DB connections %` · `slow queries (>200ms)` · `replication lag` · `queue depth & job age` · `sync lag (last successful sync per store)` · `storage growth/day` · `Redis memory` · `SMS/OTP failures` · `AI cost/day`.

---

### Stage 0 — Alpha (1–10 stores)
**Goal:** Learn from reality. Not scale.
- **Infra:** One Next.js app on the chosen hosting (05) + managed Postgres (Neon Free at the start) + a private encrypted backup (05 section 5 R4). **Note:** Vercel Hobby is non-commercial only (05 section 0).
- **Cloudflare** in front of the server + SSL.
- **Backups:** Daily + WAL archiving if the managed DB supports PITR.
- **Monitoring:** Sentry + Uptime check + logs.
- **Main risk:** A single point of failure (SPOF) — acceptable in Alpha **provided** the backup has actually been tested (one real restore).
- **Transition indicator to Stage 1:** 10 stores running for two weeks with no data loss + a tested backup.

### Stage 1 — Beta (10–100 stores)
- **DB:** Managed, **Pooled** connection (necessary for serverless) + paid PITR when the indicators call for it (05 section 7).
- **App:** One Next app (Vercel Pro or Docker `standalone`), with no permanent Workers: jobs live in the `jobs` table + cron tick.
- **Redis:** Not required in V1 (if Rate limiting is needed: Upstash or a Postgres table).
- **Additions:** Rate limiting for OTP (attempts + SMS cost), a separate Staging environment.
- **What could break:** (a) Slow report queries eating the DB → the fix: `daily_store_stats` exists from the start. (b) OTP abuse → limits per number/IP/device.
- **Transition indicator:** Sustained DB CPU > 50–60%, or read p95 > target, or connections > 70%.

### Stage 2 — First growth (100–500 stores)
- **App:** Fully stateless; on Vercel it scales automatically, and on Docker 2–3 instances behind a Load Balancer.
- **DB:** A bigger Primary + a **Read Replica** for reports and the AI (the replica takes the heavy reads).
- **Cache:** Optional: Redis/Upstash for subscription limits and `ai_usage`, otherwise a Postgres table with a TTL at first.
- **Indexes:** Review `EXPLAIN` for every hot query, a composite index `(store_id, created_at)` on the large tables.
- **Sync:** Fix the batch size limits + Backoff with Jitter on the mobile.
- **What could break:** A sync storm after a power/internet outage across a whole area → section 7.
- **Transition indicator:** Storage of the large tables is starting to slow the indexes / VACUUM takes a long time / report time is increasing.

### Stage 3 — Expansion (500–2,000 stores)
- **Monthly partitioning** for `sales, sale_lines, stock_movements, change_log` (+ an archiving policy: data older than X months moves to cold storage and stays available through "old reports" (تقارير قديمة)).
- **Jobs:** If the cron tick inside Next is not enough → an independent Worker or a real Queue (BullMQ+Redis or an alternative), decided by measurement.
- **Full observability:** Tracing (OpenTelemetry) + Alerts on the indicators.
- **Multi-AZ** for the DB (if the provider supports it) + an actual Failover test.
- **Feature flags** to roll out features gradually.
- **What could break:** (a) A very large store (5,000+ products and thousands of sales/day) creating a "Noisy Neighbor" → per-store limits + monitoring of the top 20 stores by consumption. (b) SMS/AI cost → limits and alerts.
- **Transition indicator:** Primary write load is near the machine's limit, or Replica Lag is affecting reports.

### Stage 4 — Large scale (2,000–5,000 stores)
- **Separate Sync** as an independent Deployment (same code, separate deployment with different limits).
- **Separate AI Service** (queries from the Replica only, CPU/Time limits).
- **DB:** A bigger Primary + more than one Replica + `autovacuum` review + `pg_stat_statements` weekly.
- **Reports:** Any new report is rejected if it reads huge raw tables without an aggregate table.
- **CDN/Edge caching** for assets and the public API if there is one.
- **Scheduled Load Test** before every major launch (sync storm scenario + evening peak).
- **Transition indicator:** Data volume/Primary write load approaches the limit of a single machine even after optimizations.

### Stage 5 — 10,000 stores
Two options for the database, **the decision is taken by measurement, not by guessing:**

| Option | When | Pros | Cons |
|---|---|---|---|
| **A. Scale Up** (bigger Primary + Partitioning + Replicas + archiving) | If writes and volume are still within the limits of one machine | The simplest, no code change | A practical ceiling, slower Failover if the DB is huge |
| **B. Sharding by `store_id`** (each Shard holds a group of stores) | If A has reached its limit | Horizontal capacity, higher isolation | Complexity: Router, Migrations on every Shard, reports across Shards |

- If B: a `store_directory(store_id → shard)` table + a connection-selection layer in the API (because all queries are already by `store_id`, the design is suitable from day one — this is why `store_id` on every table is not optional).
- **Multi-Region/DR:** A ready copy (Warm Standby) in another region according to the hosting and legal decision.
- **Formal SLOs + Error Budget + On-call.**
- **Team:** At least one DevOps/SRE engineer.

### Summary table "if X happens, do Y"
| Symptom | Probable cause | Action |
|---|---|---|
| API p95 rose | Slow query / connections | `pg_stat_statements` + add an index + increase pooling |
| DB CPU sustained high | Reports on raw tables | Move them to `daily_store_stats` or a Replica |
| `queue age` is growing | Too few Workers | Add Workers / split the queues (SMS separate from Reports) |
| Replica Lag is growing | High writes / a heavy Query on the Replica | Query limits + acceptable delay for reports |
| Storage growing faster | Huge movement log | Partition + archiving + compression |
| OTP failures | SMS provider | Fallback to another provider + limits |
| Redis memory (if used) | Keys without TTL | Mandatory TTL + `maxmemory-policy` |

---

## 7. Failure scenarios and possibilities (what could take the platform down)

| # | Scenario | Impact | Prevention | Response |
|---|---|---|---|---|
| 1 | **Sync storm**: an area's internet/power goes out and comes back for everyone at once | Huge pressure on `/sync` | Backoff + random Jitter on the mobile, per-store Rate limit, small batches | The API returns `429 Retry-After`, a Queue instead of direct processing if needed |
| 2 | **DB loss / corruption** | Data loss for all stores | PITR + external Backups + quarterly restore test | A written DR plan: RTO ≤ 2 hours |
| 3 | **A Migration locks a large table** | Service outage | Expand/Contract: add a column → migrate → drop the old one later, `CREATE INDEX CONCURRENTLY` | Rollback ready + Migrations tested on a copy of real data |
| 4 | **A bug in FEFO / inventory** | Wrong numbers at stores (the most dangerous kind) | Inventory-specific Tests (Property-based), an append-only movement table that allows recalculation | A "recalculate balance from movements" script |
| 5 | **Data leak between stores** | Legal and reputational disaster | Mandatory RLS, Cross-tenant tests that fail CI if a leak appears | Immediate shutdown + investigation + notification as required by law |
| 6 | **OTP/SMS abuse** | High cost + blocking | Limits per number/IP/device + CAPTCHA when suspicious | Circuit breaker on sending |
| 7 | **High AI cost** | A bill | 5 messages/day **enforced on the server** + Timeout + daily Budget | Lock the feature when the limit is reached |
| 8 | **Wrong device clock** | Wrong operation order / wrong reports | Ordering by `server_ts` + a note if the difference is large | Alert the user "your device clock is wrong" (ساعة جهازك غلط) |
| 9 | **An app update breaks the old version** | Stores not syncing | `schema_v` + support for two consecutive versions | An "update the app" (حدّث التطبيق) screen while preserving the queue |
| 10 | **Stale Service Worker Cache** | The user is stuck on an old version | A clear update strategy + `skipWaiting` with the user's permission | A Kill switch from the server |
| 11 | **Dependence on a single provider** (SMS/hosting) | Outage | Abstraction layer + a ready alternative provider for SMS | Documented manual Failover |
| 12 | **A huge store / Hot Tenant** | Slowness for the other stores | Per-store limits + monitoring | Move it to a dedicated Shard/Pool (Stage 5) |
| 13 | **Subscriptions: manual renewal transfer verification** | Disputed transfer or delayed confirmation | Manual transfer confirmation via WhatsApp + audit-logged admin activation (ADR-0008) | Admin review and audit log |
| 14 | **Law/regulation** (data/invoices) | Shutdown/fine | Lawyer review before production + a clear privacy policy | A quick hosting-change plan |
| 15 | **A small team gets tired / a single person holds the key** | Slowness/outage | Documentation + Runbooks + Infra as Code | Train a backup |

---

## 8. Security at scale

- **Auth:** OTP + password (Argon2id) + a **rotating httpOnly cookie session** stored in the DB (same origin) + reuse detection.
- **Isolation:** RLS on every table + an automated Cross-tenant test in CI.
- **Secrets:** Secret Manager (not `.env` files in Git).
- **Encryption:** TLS everywhere + encrypted Backups + Disk encryption.
- **Auditing:** `audit_log` for any sensitive operation (delete, permission changes, export).
- **WAF + Rate limits** on Cloudflare + limits at the application level.
- **Automatic dependency review** (Dependabot + `npm audit` in CI).
- **External Pentest** before public launch and/or at 1,000 stores.

---

## 9. Observability & Ops

- **Structured JSON logs** (with `store_id` and `request_id`, **without** sensitive data).
- **Metrics:** Prometheus/Grafana or a managed alternative.
- **Tracing:** OpenTelemetry (from Stage 3).
- **Alerts:** On the indicators in section 6, to a clear channel (Telegram/Slack/Email).
- **Status page** for customers from Beta.
- **Runbooks** for every scenario in section 7.
- **Periodic tests:** Backup restore (quarterly) · Failover (from Stage 3) · Load test (before every stage).

---

## 10. Cost management (without prices)

- **The 3 biggest expected cost items:** the database, SMS, AI. Monitor them by name.
- **Control:** Daily AI limits, SMS for registration only (not notifications), archiving of old data, Reserved/Committed instances once consumption stabilizes.
- **Unit of calculation:** `cost ÷ active stores` monthly — it must be clearly lower than the subscription price. You calculate this number from your actual bills.

---

## 11. Decision Log and alternatives

| Decision | Alternatives studied | Why we chose this |
|---|---|---|
| Offline-first PWA | Native app / Flutter | Development speed, instant updates, small team |
| One Next.js app (Modular Monolith) | A separate NestJS API / Microservices | A single deployment and less maintenance (02 sections 1–2) |
| PostgreSQL + RLS | MongoDB / Firebase | Strong transactions for inventory, RLS for isolation |
| Movement log | A balance number that gets edited | Auditability and recalculation |
| Outbox + op_id | CRDTs | Simpler and suited to the nature of the operations (movements) |
| Cloudflare | Without it | DNS+WAF+CDN with ease |
| `jobs` table in Postgres + cron tick | BullMQ/Redis/Kafka | No permanent Workers on free hosting; we move to a real Queue by measurement |

**We agreed that the definitive answers (prices, hosting location, SMS provider) are determined after: the lawyer's replies + provider quotes.**

---

## 12. Stage transition conditions (short Checklist)

- [ ] **Alpha → Beta:** 10 stores for two weeks, zero data loss, Restore tested, Sentry running.
- [ ] **Beta → 100:** Indicators Dashboard, PgBouncer, Staging, Rate limits.
- [ ] **→ 500:** Replica for reports, LB, successful Load test.
- [ ] **→ 2,000:** Partitioning, separate Workers, Multi-AZ, Tracing.
- [ ] **→ 5,000:** Separate Sync and AI, On-call, Pentest.
- [ ] **→ 10,000:** Scale-up vs Shard decision based on real measurement, DR Region, SRE.

---

## 13. Hosting and catalog (two appendices)

- **Free/paid hosting and zero-downtime upgrade paths:** `05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md`. The two most important points: (1) Vercel Hobby is non-commercial only (2) the domain is bought from day one because the PWA and IndexedDB are tied to the origin.
- **The public catalog, custom products, and store suggestions:** `06-CATALOG-AND-SUGGESTIONS.md`.
- **Catalog impact on load:** `global_products` is relatively small (thousands of rows) and read heavily → long Cache + incremental sync, so it does not change the stage table. What is new: `catalog_candidates`/`catalog_suggestions` (small size) and a Job that selects the receiving stores (batched, not at request time).
- **Event-driven sync without polling** is a condition for the free tier's lifetime (05 section 3) and it reduces load at every stage.

---

# Part 3: Roadmap & Evolution
> Source: formerly `docs/01-product.md`

> **Rule:** this Roadmap is **directions, not commitments.** Every feature after V1 enters **by data** (real usage, repeated requests from shops, metrics), not by enthusiasm. Simplicity above everything.
> No invented dates or numbers here. Dates are set after Alpha, and numbers come from reality.

---

## 1. Admission rule for any new feature (Feature Admission)
A feature enters the Roadmap if **all** of these conditions are met:
1. **A real need:** ≥ X shops (X from Alpha/Beta) asked for it or use a manual workaround for it.
2. **It does not add a step** to the core path (sell/add goods), or it removes a step of equal size.
3. **It is done in few steps** and with a simple screen on mobile.
4. **Works offline** or there is a clear decision on why not.
5. **Its cost** (development + maintenance + plan/SMS/AI consumption) is known and acceptable.
6. **Conflicts with** a principle in `07` section 3? No.
**Removal rule:** a feature with low usage after a measurement period = gets simplified or removed.

## 2. Release overview

| Release | Goal | Enters when… |
|---|---|---|
| **V1 (launch)** | The eight pages + offline + shared catalog + subscription and payment + AI | Phases 0–7 in `04` are done |
| **V1.1** | Improvements from Alpha/Beta + the top requests | Beta data says what matters most |
| **V1.2** | Selling productivity and reducing manual entry | Selling or adding goods is the bottleneck |
| **V2** | Shop team + report depth | Large shops ask for workers/permissions |
| **V3** | Expansion (branches/integrations/native) | A stable customer base |

## 3. Candidate features (ordered by initial priority — changes with data)

### V1.1 — Initial improvements
| Feature | Why | Notes |
|---|---|---|
| **A cart with more than one item in an invoice** | Faster selling if the customer buys several things | Tables are ready (`sales` + `sale_lines`). Done without slowing the single-item sale |
| **Barcode scanner via camera** | Faster add/sell, matches the catalog | Web `BarcodeDetector` + a wasm fallback; test on weak devices |
| **Worker permissions (cashier)** | A worker who only sells and cannot see profits | The role exists in `member_role`; screens + server check |
| **Automatic WhatsApp reminder for "owed to you" debts** | Faster collection | A `wa.me` link with ready text (no API) |
| **Suggestion improvements** | Catalog quality | Tune the filters/cap/N from acceptance data |
| **Import products from CSV/Excel** | Faster first setup for the shop | Goes through the same catalog matching |
| **Export reports (CSV/simple PDF)** | For the accountant | From `daily_store_stats` |

### V1.2 — Reducing entry
| Feature | Why | Notes |
|---|---|---|
| **Voice input** (the microphone button in the demo) | Add/sell hands-free | Web Speech API if supported; dialect testing required; not essential |
| **Reorder suggestion** | "What should I order?" | From average daily sales + balance + lead time; **computed with SQL, not an LLM** |
| **Simple sales/stock forecasts** | Planning | Simple statistics (averages), with no accuracy claims |
| **Supplier orders** | A ready message with the order for the supplier | WhatsApp/copy text |
| **Scan the supplier invoice (OCR)** | Faster goods entry | **Experimental**, after measuring feasibility and accuracy |

### V2 — Team and depth
| Feature | Notes |
|---|---|
| **More than one user/device with detailed permissions** | A log of who did what (`audit_log` exists) |
| **Shift/day close** (cash in the drawer) | If shops ask for it |
| **Deeper reports** (profit by item/category, supplier activity) | New aggregate tables, not queries on raw data |
| **Supplier rating/purchase price comparison** | From batch history |
| **Suggested pricing** | From cost and margin, **a suggestion, not a decision** |
| **Broader admin dashboard** | Support, catalog, monitoring shop health |

### V3 — Expansion (needs strategic and legal review)
| Feature | Notes |
|---|---|
| **Multiple branches** | A change to the `store` model; a big ADR |
| **Native wrapper** (TWA/Capacitor) for the Play Store | Same PWA; real Push notifications |
| **Government electronic invoice/receipt** | ⚖️ Needs verification of current requirements and an approved authority; **we do not assume** |
| **Public API and integrations** | After the schema stabilizes |
| **Other languages** | i18n |
| **Invoice printing/thermal printers** | If there is real demand, via Bluetooth/an intermediary |
| **Marketplace/online ordering for the shop** | Far off; outside the current principle |

### Deferred ideas (until the need is proven)
Product images · loyalty points · automatic offers and discounts · full accounting · budgeting · human resources.

## 4. Product evolution after launch (a cycle)
```
Measure (actual usage, where does the user stop?)  →  Interviews (every week in Alpha/Beta)
   →  Priorities (Top 10 by data)  →  Implement a small phase (2 weeks)  →  Measure the impact  →  Repeat
```
**Metrics to track from day one (without personal data):** days of use/week, sales operations/shop/day, rejected-operations ratio, sync time, UI errors, usage of each page, suggestion acceptance, AI usage, retention rate.

## 5. Technical capability evolution (tied to `01` and `05`)
| Event (happens by measurement) | Action |
|---|---|
| First paying customer | Commercial hosting (`05` section 0) |
| Storage/CU-hours passed 70% | Upgrade Neon (a plan upgrade without migration) |
| p95 or connections passed the limits | Indexes/Pooling then bigger resources |
| The tick is not enough | A standalone Worker or a real Queue |
| Sync became the heaviest | Split it out as a standalone Deployment |
| Large table size | Monthly Partitioning + archiving (Stage 3) |
| Nearing the limit of one machine | A Scale-up or Sharding by `store_id` decision (Stage 5) |
| We need Push | Web Push (VAPID) + iOS testing |
Detailed stages and indicators are in `01` section 6, `05` section 7 and `04` (G0–G5).

## 6. Team evolution
| Stage | Minimum team | Notes |
|---|---|---|
| Phase 0–5 | You + AI Agent (Antigravity) + human review | Human review of Sync/FEFO/RLS/Auth/payment is mandatory |
| Alpha/Beta | + a part-time support/product person | Visits and calls to shops |
| 500+ shops | + a second developer | Support and on-call load |
| 2,000+ shops | + DevOps/SRE | Monitoring, Failover, cost |
| 5,000+ shops | + a support/sales team | Formal on-call |
No headcounts/salaries here; the budget comes from reality (`04` P0-B-03).

## 7. Subscription evolution (without invented prices)
- **V1:** one simple plan + a trial period. The price comes from the actual cost calculation ÷ active shops + margin (after Alpha).
- **Later (by data):** a higher plan for (workers/branches/reports), or annual with a discount. **We do not add plans before shops ask for a difference in usage.**
- **Fixed rule:** subscription expiry = read-only, **no data deletion**.
- Local payment methods (gateways/InstaPay/Fawry) are verified with the providers.

## 8. Roadmap risks
| Risk | Action |
|---|---|
| **Feature creep** (adding features that spoil simplicity) | The admission rule (section 1) + the removal rule |
| Building on one opinion | Data + 5+ shops |
| V2/V3 features increasing complexity prematurely | We do not start V2 before V1 achieves the target retention |
| The Agent drifting into unrequested features | `AGENTS.md`: one phase, `15` for decisions |
| Relying on unproven features (OCR/voice) | Experimental + measurement + quick disable (flags) |

## 9. Roadmap review
At every **phase end** (Alpha, Beta, every 500 shops): we review the priorities, update this file, and record the decisions in `15`.

---

# Part 4: Decisions and Open Questions
> Source: formerly `docs/01-product.md`

> This file is the **source of truth** for decisions: what has been decided, what is open (and who decides it), what must be verified, and which assumptions are to be measured.
> **The Agent:** before deciding anything that is open, ask. And any value you guessed (a limit/constant) must be recorded in section 5.

---

## 1. Decisions made
| # | Decision | File | Status |
|---|---|---|---|
| D1 | **Single Next.js app** (no separate API/NestJS) | 02, 08 | ✅ |
| D2 | Offline-first PWA: Dexie + Outbox + Service Worker | 02, 10 | ✅ |
| D3 | Postgres + RLS (`store_id` on every table) + Drizzle | 08, 09 | ✅ |
| D4 | Sync = `/api/sync/*` Route Handlers (not Server Actions) | 02 section 2 | ✅ |
| D5 | Sync is **event-driven, no polling** | 02, 10 | ✅ |
| D6 | Inventory = batches + append-only movements, FEFO selling, reversing void | 02, 09 | ✅ |
| D7 | Money as integer piastres, quantities as integer (piece/gram) | 09 | ✅ |
| D8 | Rotating httpOnly cookie session (not a JWT in IndexedDB) | 02, 12 | ✅ |
| D9 | Jobs in a Postgres table + cron tick (no Redis in V1) | 02, 08 | ✅ |
| D10 | CSS variables + CSS Modules ported from the demo (not Tailwind) | 08, 11 | ✅ (revisable) |
| D11 | Post-login app is Client-only under `/app` | 02 section 3.1 | ✅ |
| D12 | AI: numbers from SQL only, 5/day limit enforced on the server | 02, 09 | ✅ |
| D13 | Negative balance is **allowed** and flagged (the real-world sale actually happened) | 01, 10, 11 | ✅ (revisable) |
| D14 | Subscription expiry = read-only, **no data deletion** | 12, 14 | ✅ |
| D15 | Catalog: store identity hidden, price/stock are not shared | 06 | ✅ (⚖️ lawyer) |
| D16 | Paid domain from day one | 05 section 4 | ✅ |
| D17 | Vercel Hobby for development only; any customers = commercial hosting | 05 section 0 | ✅ |
| D18 | Remove the floating (+) button from the demo | 07 | ✅ |
| D19 | Alert: near-expiry ≤ 7 days, "running low" thresholds from `09` section 8 | 09, 11 | ✅ (customizable) |
| D20 | **Use Webpack for build and dev** (`--webpack`) because Serwist requires Webpack plugins | ADR-0002 | ✅ (ADR proposed) |
| D21 | **Local Postgres host port 5434** (`HESBA_POSTGRES_PORT=5434`) to avoid port collision with host PostgreSQL | 17, docker-compose | ✅ |
| D22 | **Node >=22 and pnpm 10.20.0 pinned** for deterministic builds and LTS runtime support | package.json | ✅ |
| D23 | **`agentRules: false` in `next.config.ts`** to prevent Next.js CLI from mutating `AGENTS.md` | next.config.ts | ✅ |
| D24 | **Manual subscription renewal**: subscriptions are renewed by manual transfer (Vodafone Cash or InstaPay), confirmed on WhatsApp, and activated by the owner | ADR-0008 | ✅ Accepted |
| D25 | **Product variants**: every sellable item is a product; variants carry flavor, size, unit, pack quantity, barcode, price, stock | ADR-0009 | ✅ Accepted |
| D26 | **Services and commissions**: serialized cards sold once (PIN encrypted with HESBA_CARD_KEY); bills/transfers non-stock with rule-based fee | ADR-0010 | ✅ Accepted |

## 2. Open decisions (need your input)
| # | Decision | Options | My recommendation | Needed before |
|---|---|---|---|---|
| O1 | **Hosting** | A: Vercel Pro · D: VM + Docker · C: Cloudflare | After verifying the ❓ points in `05`: A for simplicity, or D if you are sure of the terms | Phase 1 |
| O2 | **SMS provider (OTP)** | (to be decided from actual quotes) | One that reliably delivers to Egyptian numbers + simple API + a fallback | Phase 2 |
| O3 | **Subscription renewal** | Settled (D24 / ADR-0008: Manual renewal via Vodafone Cash & InstaPay) | Manual transfer + WhatsApp confirmation; activated by owner | Settled ✅ |
| O4 | **LLM provider** | (compare cost and quality in Arabic) | Behind an interface; start with the cheapest that is good enough | Phase 4 |
| O5 | **Hesba name/brand** | Check domain and trademark availability ⚖️ | Before any marketing spend | Phase 0 |
| O6 | **Catalog values:** daily suggestion cap, size of the first wave, N for promotion, K for reports | (06 section 1) | Start with small, conservative values and adjust by measurement | Phase 4 |
| O7 | **Default sharing:** enabled (opt-out) or disabled (opt-in)? | opt-out / opt-in | opt-out with full transparency, **after lawyer approval ⚖️** | Phase 2 (sign-up) |
| O8 | **Demo data at sign-up** | Mixed-in fake data / ready to delete with one button / remove it | Ready to delete with one button, flagged `demo=true` | Phase 2 |
| O9 | **Selling an "out of stock" product** | Block / allow and flag negative | Allow and flag negative (D13) | Phase 3 |
| O10 | **2FA for the admin account** | Mandatory / optional | Mandatory | Phase 4 |
| O11 | **Retention policy** (sync_ops, audit, account deletion) | Durations | After the lawyer ⚖️ | Phase 5 |
| O12 | **On-device catalog search library** | Search on `name_norm` only / lightweight library | Start simple and measure | Phase 3 |
| O13 | **Router inside `/app`** | React Router / TanStack Router | The simplest and smallest after a quick comparison | Phase 1 |
| O14 | **Plan and pricing** | (from the cost calculation) | After Alpha | Phase 4 |
| O15 | **Team size/Freelancers** | — | Depends on budget | Phase 0 |
| O16 | **User reporting system** (support): WhatsApp/Telegram/in-app | — | One simple channel | Phase 6 |

## 3. ❓ Verify before relying on it
| # | Topic | Verify from | Task |
|---|---|---|---|
| V1 | Current Vercel Pro price and what is included | Official provider page | P0-D-05 |
| V2 | Commercial-use terms for Cloudflare (Workers/Pages) and Next compatibility | Their docs + a test | P0-D-05 |
| V3 | Free hosting alternatives that allow commercial use | Providers | P0-D-05 |
| V4 | Cron limits on the chosen hosting | Their docs | P0-D-05 |
| V5 | Minimum CU on Neon Free | Their docs | P0-D-05 |
| V6 | S3-compatible storage (free/paid) | Providers | When needed |
| V7 | **Antigravity:** reading of `AGENTS.md` and `.agents/rules/` and the 12,000-character limit | Official Google docs + a trial | Before Phase 1 |
| V8 | **Serwist** compatible with the pinned Next version | Its docs + a trial | P1-F-01 |
| V9 | `set_config` on the pooled URL in Neon | Actual test | P1-B-03 |
| V10 | Argon2 timing on the chosen hosting | Measurement | P2-B-01 |
| V11 | Function timeout and request size limit (determines the Sync batch size) | Hosting docs | P2-B-04 |
| V12 | Government e-invoice/e-receipt requirements | ⚖️ Lawyer/official source | Before V3 |
| V13 | iOS behavior (PWA install, IndexedDB, Push) | Device test | Phase 5 |

## 4. ⚖️ Legal (lawyer before production)
1. Personal Data Protection Law 151/2020: consent, purpose, retention, user rights, reporting, registration/licensing.
2. **Where data is stored** (transfer outside Egypt) → determines hosting.
3. Terms and privacy (including third-party data: the store's customers/suppliers).
4. **Sharing product definitions** between stores + anonymization + opt-out option.
5. Advertising and marketing claims.
6. Trademark and name.
7. Recurring subscriptions and the cancellation and refund policy.

## 5. Assumptions and values that must be measured/determined (log of guessed values)
| Value | Current assumption | Measured from | Updated in |
|---|---|---|---|
| Sales/store/day `S` | 150 (calculation assumption) | Alpha | `01` section 2 |
| Items/invoice `L` | 3 | Alpha | `01` |
| Devices/store `D`, working hours `H`, peak `K` | 2 / 10 / 3 | Alpha | `01` |
| Row size `B` | 250 bytes | DB measurement | `01` |
| Storage growth/store/day | ≈ 0.3 MB | Alpha | `05` section 3 |
| Maximum operations per push request | (small value, to be tuned) | Hosting timeout + measurement | `constants.ts` |
| Sync debounce | (a few seconds) | Usage experience | `constants.ts` |
| OTP limits (attempts, sends/day, validity) | (determined with the SMS provider) | Provider | `constants.ts` |
| Daily suggestion cap, N, K | (small values) | Acceptance rate | `constants.ts` |
| Bundle size budget | (after the first Build) | Build | CI |
| Argon2 parameters | (after measurement) | Measurement | `config` |
| Alert thresholds (3 kg, 2× carton, 10, 7 days) | From the demo | Store feedback | `09` section 8 |
| Performance targets (p95…) | `01` section 1 (preliminary) | Load test | `01` |
**The Agent:** any new value you guess is added here and flagged in the code with a comment `// ASSUMPTION: see docs/15`.

### 5.1 Data to be provided by owner before Phase 3
The owner must provide the following data before Phase 3:
- Products master list: TBD by owner (owner to provide)
- Prepaid card denominations and prices per network: TBD by owner (owner to provide)
- Bill providers: TBD by owner (owner to provide)
- Transfer commission tiers: TBD by owner (owner to provide)

## 6. ADRs (required architecture decisions)
| # | Title | Status | Written in |
|---|---|---|---|
| 0001 | Project structure (single package, import boundaries) | Proposed (from 03) | Phase 1 |
| 0002 | Use Webpack for build and dev because Serwist needs it | Proposed | Setup |
| 0003 | `change_log`: Trigger or Repository | **Open** | Phase 2 |
| 0004 | Session storage (rotating cookie) | Settled (D8) — to be documented | Phase 2 |
| 0005 | Service Worker update strategy + Kill switch | **Open** | Phase 1–2 |
| 0006 | SMS provider | Proposed | Phase 0 |
| 0007 | Hosting and data residency | Proposed | Phase 0 |
| 0008 | Manual renewal via Vodafone Cash and InstaPay | Accepted | Phase 0 |
| 0009 | Product variants | Accepted | Phase 0 |
| 0010 | Services: prepaid cards, bills and transfers with commissions | Accepted | Phase 0 |
| 0011 | Local catalog search library | **Open** (O12) | Phase 3 |
| 0012 | Router inside `/app` | **Open** (O13) | Phase 1 |
| 0013 | LLM provider | **Open** (O4) | Phase 4 |
The template is in `docs/adr/template.md`. The Agent writes the draft, and you approve.

## 7. Decision change log
| Date | Change | Reason |
|---|---|---|
| 2026-10-15 | From NestJS+Vite to a single Next.js app | Simpler deployment and maintenance |
| 2026-10-15 | From BullMQ/Redis to a jobs table + cron | Free/serverless hosting |
| 2026-10-15 | From JWT in IndexedDB to an httpOnly cookie | Higher security, same origin |
| 2026-10-17 | Added the full package (07–16) + AGENTS.md | Preparing for Antigravity |
| 2026-10-20 | Use Webpack for Serwist, host Postgres port 5434, Node >=22, pnpm 10.20.0, agentRules false | Repository setup and local environment requirements |
| 2026-10-24 | ADR-0006 (SMS, proposed), ADR-0007 (Hosting, proposed), ADR-0008 (Manual renewal via Vodafone Cash/InstaPay, accepted) | Phase 0 decisions |
| 2026-10-24 | Switched Phase 4 billing to manual renewal (ADR-0008). Task IDs repurposed: P4-B-05 (manual admin activation and audit logging), P4-F-03 (renewal info and WhatsApp link), P4-Q-03 (manual renewal and expiry tests), S-20 (receiving accounts setup) | Owner decision (simplicity, familiar Egyptian transfer methods, zero card data stored) |
| 2026-10-24 | ADR-0009 (Product variants, accepted), ADR-0010 (Services: prepaid cards, bills and transfers with commissions, accepted) | Phase 0 decisions (P0-D-06) |
