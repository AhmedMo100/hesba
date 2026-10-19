# حسبة (Hesba) — Free Hosting and a Zero-Downtime Upgrade Path

> Goal: start at the **lowest possible cost**, and scale up (domain, database, servers) **without users noticing and without losing their data**.
> Figures in tables marked ✔ were verified from the providers' official pages on **2026-10-15**. Free tiers change: **re-verify before any decision**.
> Anything marked ❓ has not been verified yet, and is recorded as a verification task in `04-TASKS.md` (P0-D-05).

---

## 0. The 5 most important facts (read these first)

1. ✔ **Vercel Hobby (free) is allowed for personal, non-commercial use only.** Their definition of "commercial": any deployment used to make financial gain for anyone involved in producing the project, including any way of requesting or processing payment from visitors. **Hesba is a paid-subscription platform = commercial**, so we need Pro (or an alternative that allows commercial use) **before the first paying customer**. This is not a detail: the account can be suspended.
2. ✔ **The free database (Neon)** is limited to 1 GB per project and 100 CU-hours, it sleeps after 5 minutes of idleness, and its restore window is only 6 hours. That means **we need our own backups**.
3. **The domain must be bought from day one** (it is not free), because the PWA, IndexedDB and the Service Worker are tied to the **origin**. If you change the domain later, users lose the installation and the local operations queue. (Details in section 4.)
4. **Polling kills the free tier.** If the app asks the server every minute, the database will never sleep and will burn CU-hours for nothing. **Event-driven sync only** (section 3).
5. **Offline-first makes upgrading easier than you would expect:** every operation is recorded locally and sent with an `op_id`, so if the server is down for a few minutes during a migration, shops keep selling as usual and operations sync afterwards. (Section 5.)

---

## 1. Free-tier limits (the ones we verified)

| Service | Free limits ✔ | What it means for Hesba |
|---|---|---|
| **Vercel Hobby** | Non-commercial only · 1,000,000 Function invocations/month · 4 hours Active CPU · 100 GB Fast Data Transfer · 10 GB Origin Transfer | **Not allowed for paying customers** ❗ |
| **Neon (Postgres) Free** | 100 projects · **1 GB storage/project** · **100 CU-hours/project** · autoscale up to 2 CU · **Scale-to-zero after 5 minutes (it is not shut down)** · **6-hour** history window · one manual Snapshot · 5 GB Egress/project | Enough for Alpha and part of Beta. Backups are on us |
| **Neon Launch (paid, for upgrading)** | Pay-as-you-go: Compute $0.106/CU-hour · storage $0.35/GB-month · Instant restore $0.20/GB-month · 500 GB Egress included · history up to 7 days | Upgrading is done by changing the plan, with no data migration ✔ |
| **Supabase Free** | 500 MB DB · 1 GB files · 5 GB Egress · **project is paused after one week of inactivity** · **no Backups or PITR** · 2 projects | **Not suitable** as the primary database (pausing + no backups). Possibly later as file storage only |
| **Cloudflare Workers Free** | 100,000 requests/day · **10 ms CPU/request** · 50 subrequests/invocation | ❓ Commercial-use terms not verified. And 10 ms CPU is far too tight for a full Next app |

Sources: [Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines) · [Neon Pricing](https://neon.com/pricing) · [Supabase Pricing](https://supabase.com/pricing) · [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/).

### Not sure about these (verification tasks before the decision)
- ❓ The current Vercel Pro price and what is included (it was not retrieved from the official source in this research).
- ❓ Does Cloudflare allow commercial use on the free tier for Workers/Pages? And does Next App Router (OpenNext) actually run within the CPU limits?
- ❓ Free hosting alternatives that allow commercial use (an always-free VM + Docker)? If confirmed, that becomes a "truly free" path for the app itself.
- ❓ Cron limits on the plans (runs per day) — they affect the jobs (section 3).
- ❓ The minimum CU in Neon Free (it affects the CU-hours calculation).
- ❓ Cloudflare R2 or an S3-compatible alternative for files (free limits).

---

## 2. Hosting: the options, frankly

> The project is **built Portable** (section 6), so the choice here is not a lock-in. You can start with any one and move between them.

| Option | Starting cost | Allows commercial use? | Pros | Cons |
|---|---|---|---|---|
| **A. Vercel Pro + Neon Free** | First fixed cost | ✔ Yes (Pro) | Easiest Next deployment, Preview for every PR, zero server maintenance | Monthly cost from the first customer, Functions have CPU/duration limits |
| **B. Vercel Hobby + Neon Free** | Zero | ❌ **No** (non-commercial) | Free | **Violates the terms if there are paying customers**. For internal development with no customers only, and written confirmation from their support is preferable |
| **C. Cloudflare (Workers/Pages) + Neon Free** | Zero | ❓ Must be verified | Strong CDN, generous daily limits | 10 ms CPU, Next compatibility needs testing, ❓ |
| **D. Always-free VM + Docker (`next start`) + Neon Free** | Zero | ❓ Must be verified | Full control, no Functions limits | **You** are responsible for maintenance, security, SSL and Backups, and there is no auto-scaling |

### My recommendation
1. **Development and internal experiments (with no real customers):** B (Hobby) is acceptable, but ask Vercel support in writing if you plan to use it with trial shops.
2. **From the first real shop (even if Alpha is free for that shop):** treat it as **commercial**, because you stand to gain from the project. Choose **A** or **D** after verifying the ❓ points above.
3. **The database (Neon Free)** is suitable until storage or CU-hours reach 70% (section 5).
4. **Most important:** do not rely on a provider-locked feature (Vercel KV/Blob/Edge Config, or Supabase Auth/Realtime). Everything is written so that it can be moved (section 6).

---

## 3. How to live on the free tier as long as possible (design rules)

1. **Event-driven sync only:** run `sync` on: (a) after the last local write, with a debounce (e.g. 5–10 seconds) (b) app open (c) network back (d) tab returning to the foreground (e) the "sync now" button (زامن دلوقتي). **No** `setInterval` every minute. Reason: every call wakes the database and counts CU-hours.
2. **Batching:** one push for many operations, not one request per sale.
3. **Conditional `pull`:** `cursor` + `has_more`, and if there is nothing new, reply with a small `204`.
4. **The public product catalog** is downloaded **once**, then incremental updates (cursor), compressed (gzip/br), and stored in Dexie. (06).
5. **Reports from aggregate tables** (`daily_store_stats`), not from millions of rows.
6. **Jobs without always-on Workers:** a `jobs` table in Postgres + an `/api/cron/tick` endpoint called from an external Cron or from the provider (it executes a small batch with `FOR UPDATE SKIP LOCKED`). No Redis and no BullMQ in V1. ❓ Check the Cron limit on the plan you choose, otherwise use a free external scheduler.
7. **Files/images:** V1 has no product images (name and category are enough). If needed later: S3-compatible storage + compression + fixed sizes.
8. **Cache:** public catalog data is cached on the CDN with a long `Cache-Control` + ETag.
9. **Protection limits:** Rate limits on OTP, sync and the suggestions catalog (prevents consuming the plan by mistake or maliciously).

### Estimated lifetime of the free tier (assumptions from file 01 — **measure them in Alpha**)
```
Storage growth/shop/day     ≈ 0.3 MB   (from the table in 01: 10 shops ≈ 3 MB/day)
Lifetime of 1 GB (approx.)  = 1000 MB ÷ (shops × 0.3) days
```
| Number of shops | Storage lifetime (1 GB), approx. |
|---|---|
| 10 | ~330 days |
| 30 | ~110 days |
| 100 | ~33 days |

```
CU-hours/month ≈ database active hours/day × 30 × (minimum CU)  ← ❓ verify the minimum
Example: 12 hours × 30 × 0.25 = 90 CU-hours (close to the 100 limit)
With constant polling: 24 × 30 × 0.25 = 180 → above the free limit
```
**Bottom line:** the free database tier serves **Alpha and the first Beta (up to a few dozen shops)**. After that, upgrading to Launch (pay-per-use) is the natural step, **with no data migration**.

---

## 4. The domain (a day-one decision)

### Why buy it from the start?
The **origin** (protocol + domain) is what binds: PWA installation, the Service Worker, **IndexedDB (the mobile's local data and queue)**, and Cookies. Changing the domain = **a new origin = all of that starts from zero.** The cheapest and safest decision: pay for the domain from the beginning.

### Setup
1. Buy the domain (from a trusted registrar) and enable **Cloudflare DNS**.
2. `app.<domain>` for the app · `<domain>` for the landing page · `status.<domain>` later · `api` is **not needed** (a single Next app, same origin).
3. Automatic SSL, HSTS after stabilization.
4. Email settings (SPF/DKIM/DMARC) if you will send emails.
5. **Short TTL (e.g. 300 seconds)** before any move.

### If you are forced to change the origin later (safe migration procedure)
1. A new release on the old origin triggers a **forced full Sync** and shows a banner "اتنقلنا لعنوان جديد" ("We've moved to a new address") with a link.
2. Make sure the `outbox` is empty (or saved on the server) before switching over.
3. The new origin does a full Pull from `cursor=0` after login.
4. The old origin stays up (Redirect + banner) for **at least 90 days**.
5. Users must install the app again → prepare a simple message. **This is why it is best not to move.**

---

## 5. Zero-downtime upgrade paths (Runbooks)

### General principle
```
1) Change one thing at a time (the app or the database, not both on the same day)
2) Take a Backup + test the restore beforehand
3) Prepare the Rollback before starting
4) Use "soft maintenance mode": the server replies 503 + Retry-After.
   The mobile keeps working locally with operations queued, and after recovery they sync (idempotent via op_id).
5) Monitor the indicators for 30–60 minutes after the move
```
**Soft maintenance mode:** the Sync endpoint replies `503` with `Retry-After`, and the SyncBar shows "السيرفر بيتحدّث، شغلك محفوظ" ("The server is updating, your work is saved"). **No operation is lost** because it is stored on the device.

### R1 — Hosting upgrade (Hobby → Pro, or moving between providers)
| Step | Details |
|---|---|
| Upgrading the plan on the same provider | **Plan change only, no migration and no downtime** ✔ (for Vercel: change the plan) |
| Moving to another provider/server (Docker) | 1) Build `next build` with `output: 'standalone'` in Docker 2) Run it in parallel on a new environment with the same environment variables and the same database 3) Test `/api/health` and `sync` on it 4) Switch DNS (short TTL) 5) Leave the old one for 48 hours 6) Rollback = revert DNS |
| Why is it safe? | The application layer is **Stateless** and the database is shared, so both versions can run at the same time without conflict |

### R2 — Database upgrade/migration
| Case | Method |
|---|---|
| **Neon Free → Neon Launch** | Plan upgrade only (same project) ✔. No migration |
| **Increasing space** | Automatic on the paid tier (billed by usage) ✔ |
| **Small database (≤ a few hundred MB)** | `pg_dump` + `pg_restore` in a short window under soft maintenance mode |
| **Larger database** | **Logical Replication** (`PUBLICATION` / `SUBSCRIPTION`) to the new database, watch the lag until zero, soft maintenance mode for a few minutes, switch `DATABASE_URL`, verify, and return to normal |
| **Before any migration** | Verify: same Postgres version + same Extensions (`pg_trgm`, `uuid` ...) + RLS test on the new one |
| **Rollback** | The old `DATABASE_URL` stays ready + the old database is read-only for 48 hours |
| **After the migration** | Run a reconciliation script (row counts + sum of movements for a sample of shops) |

### R3 — Storage growth
1. First: **reduce** (aggregate tables, archiving, deleting old technical data such as `sync_ops` older than X days).
2. Second: **Partitioning by month** (Stage 3 in file 01).
3. Third: **plan upgrade** (cheaper than complex engineering at the start).

### R4 — Backups on the free tier (mandatory)
Neon Free keeps only 6 hours of history ✔, so we need:
- A **daily Job** (GitHub Actions or an external Cron) that makes an **encrypted** `pg_dump` (age/GPG) and uploads it to external storage separate from the provider.
- A **restore test** on a test database **monthly** during Alpha.
- Encryption keys stored separately (not in the same repo).
- Retention: daily 14 days + weekly 8 weeks (adjustable).

---

## 6. "Portability" rules (so upgrading stays easy)

1. **Plain Postgres:** no reliance on provider-specific features (Supabase Auth/Realtime/RLS helpers, Neon-only features in the code). Branching for Dev only.
2. **ORM + SQL migrations** (Drizzle) — without Prisma Accelerate/Data Proxy.
3. **Every setting in environment variables** (`HESBA_*`) defined in `src/server/config/env.ts` (zod).
4. **File storage** through an S3 interface — not a provider-specific SDK.
5. **No** Vercel KV / Blob / Edge Config / provider-specific `@vercel/*`, except behind an interface we can swap.
6. **Next with `output: 'standalone'` ready** from day one and built in Docker in the CI (even if deployment is on Vercel) — to make sure it runs outside it.
7. **`DATABASE_URL`** supports Pooled (for serverless) and Direct (for migrations) — kept separate.
8. **Cron/Jobs** via an HTTP endpoint protected by a secret — callable from any scheduler.
9. **Simple feature flags** in the DB (a `flags` table).

---

## 7. Upgrade indicators (when do I move?)

| Indicator | Threshold at which I move | Action |
|---|---|---|
| Neon storage | > 70% of 1 GB | Archive/reduce, then upgrade to Launch |
| Monthly CU-hours | > 70 of 100 | Review polling and queries, then upgrade |
| Egress | > 70% of 5 GB | Compress the catalog, CDN Cache, then upgrade |
| Function invocations (if Vercel) | Near the limit or Pro cost increasing | Reduce requests, or move to Docker (R1) |
| API p95 | Above target for 3 days | Indexes/Pooling, then bigger resources |
| First paying customer | **Immediately** | Hosting must be commercial (section 0) |
| 30 active shops | — | Review the paid database plan |
| First data-loss incident | — | Paid PITR + a tested Restore |

---

## 8. Phase map (free → paid) — tied to file 01

| Phase | Number of shops | Hosting | Database | Notes |
|---|---|---|---|---|
| F0 — Development | 0 | Hobby for development only | Neon Free | No real customers |
| F1 — Alpha | 1–10 | A or D (after verification) | Neon Free + own backups | Paid domain from here |
| F2 — Beta | 10–50 | A (Pro) or D | Neon Free then Launch per the indicators | First subscriptions = commercial |
| F3 | 50–500 | Pro or Docker | Neon Launch (Primary + PITR) | Replica for reports |
| F4+ | 500+ | Per file 01 (Stages 3–5) | Partitioning then a Scale-up/Shard decision | |

> The numbers in this table are **estimates**, and the indicators in section 7 are what determine the actual transition.

---

## 9. Cost (without invented prices)
- The prices that appeared in section 1 come from the providers' pages at the time of checking. **Re-verify before relying on them.**
- Calculate: `monthly cost ÷ active shops` and compare it with the subscription price. Actual figures after Alpha.
- Expected cost items, in order: **domain → commercial hosting → SMS → paid database → AI**.
