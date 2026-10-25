# Hesba (حسبة) — Complete System Design (from the first store to 10,000 stores)

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
