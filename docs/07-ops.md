# حسبة (Hesba) — Operations: Project Setup, Hosting & Agent Prompts

> Consolidated operations documentation combining:
> - **Part 1: Project Setup: From Zero to the First Commit** (formerly `docs/07-ops.md`)
> - **Part 2: Hosting, Free Tier & Upgrade Path** (formerly `docs/07-ops.md`)
> - **Part 3: Ready-to-Paste Prompts for Antigravity** (formerly `docs/07-ops.md`)

---

# Part 1: Project Setup: From Zero to the First Commit
> Source: formerly `docs/07-ops.md`

> Do this once, before Phase 1 work starts. It creates the repo, scaffolds the single Next.js app, installs the dependencies, and proves that the local environment runs.
> **Domain, hosting, providers and accounts are NOT here.** They are in the side track (`docs/04-tasks.md`, section S). Do not wait for them to start this file.
> Commands are for macOS/Linux. On Windows, run them in Git Bash or WSL.

---

## 0. What you need installed

| Tool | Why | How to check |
|---|---|---|
| Git | Version control | `git --version` |
| Node.js (current LTS) | Runtime | `node --version` |
| pnpm | Package manager (fixed in the repo) | `pnpm --version` (after step 2) |
| Docker (Desktop or Engine) | Local Postgres and the production-style build | `docker --version` |
| Antigravity | The AI agent that writes the code | — |
| A GitHub account | The repo (created in side task S-03) | — |

---

## 1. Create the repo and copy the package in

```bash
mkdir hesba && cd hesba
git init -b main
```

Copy the whole package into this folder: `AGENTS.md`, `README.md`, `.agents/`, and `docs/` (including `docs/demo/`). The folder must look like this before continuing:

```
hesba/
├── AGENTS.md
├── README.md
├── .agents/rules/
└── docs/            (00..17, adr/, demo/)
```

Commit the package first, so every later change is easy to review:

```bash
git add -A
git commit -m "docs: add project package"
```

---

## 2. Pin pnpm

Enable Corepack (bundled with Node) and pin pnpm to the current stable version:

```bash
corepack enable
corepack use pnpm@latest
```

This writes a `packageManager` field into `package.json` (it is created in step 3). Commit it with the scaffold in step 3.

---

## 3. Scaffold the Next.js app (one app, not a monorepo)

`create-next-app` refuses a folder that already has files, so scaffold in a temporary folder next to the repo and copy the result in without overwriting our files:

```bash
cd ..
pnpm create next-app@latest hesba-tmp \
  --ts --app --src-dir --eslint \
  --import-alias "@/*" --use-pnpm --no-tailwind
cd hesba
cp -Rn ../hesba-tmp/. ./
rm -rf ../hesba-tmp
```

- `cp -Rn` = copy without overwriting. Our `AGENTS.md` and `README.md` are kept.
- If a flag name has changed in the current version, run `pnpm create next-app@latest --help` and use the closest one. **Tailwind must stay off** (the CSS comes from the demo, see `docs/08`).
- Delete the sample page content later, in task P1-F-01. Do not build on it.

Then:
1. Open `package.json` and set `"engines": { "node": ">=<your LTS major>" }`. Use the Node LTS you installed.
2. Confirm `"packageManager": "pnpm@…"` is there (from step 2).
3. Commit:

```bash
git add -A
git commit -m "chore: scaffold Next.js app (App Router, TypeScript, src dir)"
```

---

## 4. Install the dependencies

Install in groups, so a failure is easy to find. Versions are pinned by the lockfile. Do not write `latest` in `package.json`. Commit `pnpm-lock.yaml` every time.

**4.1 Runtime**
```bash
pnpm add zod server-only dexie dexie-react-hooks \
  @prisma/client @node-rs/argon2 uuid pino \
  serwist @serwist/next
```

**4.2 Development and quality**
```bash
pnpm add -D prisma tsx \
  vitest @vitest/coverage-v8 fast-check \
  @testcontainers/postgresql testcontainers \
  @playwright/test \
  eslint-plugin-boundaries prettier \
  lefthook @commitlint/cli @commitlint/config-conventional
```

**4.3 Browsers for E2E tests**
```bash
pnpm exec playwright install chromium
```

**Check after each group:** `pnpm install` finishes with no errors and `pnpm-lock.yaml` changed.

**Verify before relying on them** (this is task P1-F-01 and task P1-B-01):
- Serwist works with the Next.js version you pinned, and the App Router offline navigation works.
- `@node-rs/argon2` installs on your machine and on the CI image.
- `uuid` can generate v7 identifiers.
If one fails, write an ADR (`docs/adr/`) before picking a replacement.

Sentry (`@sentry/nextjs`) is added later, in task P1-D-03, when the Sentry account exists (side task S-05).

---

## 5. Create the folder skeleton

Create the top-level folders now. The inner folders follow `docs/02-arch.md` exactly, and are created in task P1-F-01.

```bash
mkdir -p src/client src/server src/domain src/schemas \
  prisma data/catalog scripts tests public/fonts \
  .github/workflows docs/runbooks
```

Ignore environment files in Git. Make sure `.gitignore` contains:

```
.env*.local
```

(`.env.example` must stay committed, with dummy values only.)

---

## 6. Create the config files

Phase 1 tasks create these files. Here is what each one must do, so the agent and you can check them:

| File | Must do |
|---|---|
| `tsconfig.json` | `"strict": true`, `"noUncheckedIndexedAccess": true` |
| `next.config.ts` | `output: 'standalone'` · wrap with `@serwist/next` |
| `eslint.config.mjs` | `eslint-plugin-boundaries`: `src/client` may not import `src/server`; `src/domain` and `src/schemas` import nothing from app/client/server; only files in `src/server` may use `server-only` |
| `.prettierrc` | Defaults plus single quotes off, trailing commas `all` |
| `prisma/schema.prisma` | Datasource using `HESBA_DATABASE_URL` (runtime) and `HESBA_DIRECT_URL` (direct/migrations) |
| `vitest.config.ts` | Unit + property tests (`tests/unit/**`) |
| `vitest.int.config.ts` | Integration tests (`tests/integration/**`) on a real Postgres |
| `playwright.config.ts` | E2E tests in `tests/e2e/**`, mobile viewport 360px as a project |
| `lefthook.yml` | Pre-commit: prettier + eslint on staged files |
| `commitlint.config.mjs` | Extends `@commitlint/config-conventional` |
| `Dockerfile` | Multi-stage, final image runs the `standalone` build |
| `docker-compose.dev.yml` | Postgres only (MinIO only if a task needs it) |
| `.env.example` | Every variable from `docs/08` section 6, with dummy values |

---

## 7. Environment variables (local)

```bash
cp .env.example .env.local
```

Fill in only the local values. The variables (names from `docs/08` section 6):

```
HESBA_DATABASE_URL=postgres://hesba_app:<local-password>@localhost:5432/hesba
HESBA_DIRECT_URL=postgres://hesba_migrator:<local-password>@localhost:5432/hesba
HESBA_SESSION_SECRET=<generate a long random string locally>
HESBA_CRON_SECRET=<generate locally>
HESBA_APP_ORIGIN=http://localhost:3000
```

Generate a random local secret with: `openssl rand -base64 48`

- The app must **fail at startup** if a required variable is missing (`src/server/config/env.ts`, zod). That behaviour is tested in P1-B-01.
- Production and staging values never go in this file. They live in the secret store (side task S-04).

---

## 8. Start the local database

`docker-compose.dev.yml` runs a Postgres container. Pin the image to a specific major version (check the current supported major on the Postgres site and match Neon's major version later, see `docs/05`).

```bash
docker compose -f docker-compose.dev.yml up -d
```

Create the two database roles once. Save this as `scripts/sql/00-roles.sql` and run it as the superuser of the local container:

```sql
-- Migrations owner (runs prisma migrations, owns the tables)
CREATE ROLE hesba_migrator LOGIN PASSWORD 'change-me-local';

-- Application role: must NOT be superuser and must NOT bypass RLS.
-- If it could, Row Level Security would not protect shops.
CREATE ROLE hesba_app LOGIN PASSWORD 'change-me-local' NOSUPERUSER NOBYPASSRLS;

CREATE DATABASE hesba OWNER hesba_migrator;
```

Those passwords are for the local container only. Real passwords come from the secret store.

---

## 9. Scripts in `package.json`

These names are fixed (`AGENTS.md` section 6). Add them in P1-F-01 and P1-B-02:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:int": "vitest run --config vitest.int.config.ts",
    "test:e2e": "playwright test",
    "db:generate": "prisma migrate dev --create-only",
    "db:migrate": "prisma migrate deploy",
    "catalog:import": "tsx scripts/import-catalog.ts",
    "format": "prettier --write ."
  }
}
```

---

## 10. Git hooks and commit style

```bash
pnpm exec lefthook install
```

Every commit message uses Conventional Commits:

```
feat(sales): add weight quick chips
fix(sync): do not resend an acknowledged operation
docs(tasks): mark P1-B-03 done
```

---

## 11. First verification (everything must pass)

Run these in order. If one fails, stop and fix it before any Phase 1 task.

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -f docker-compose.dev.yml up -d
pnpm dev            # open http://localhost:3000 — the default page shows
docker build -t hesba .
```

If `pnpm dev` shows the sample Next.js page, that is expected at this point. Phase 1 replaces it.

### 11.1 Local gates

Summary of sequential local gate execution and health endpoint checks:

- **Date:** 2026-10-26
- **Commit:** `e0987f3`
- **Gates Sequence:**
  1. `pnpm install --frozen-lockfile` → PASS (Lockfile frozen, Prisma Client generated)
  2. `pnpm lint` → PASS (0 errors, 0 warnings, boundaries verified)
  3. `pnpm typecheck` → PASS (Strict TypeScript, 0 errors)
  4. `pnpm test` → PASS (15 test files, 78 unit/server tests passed)
  5. `pnpm test:int` → PASS (2 test files, 29 cross-tenant integration tests passed)
  6. `pnpm test:e2e` → PASS (Playwright desktop and mobile-360 offline navigation passed)
  7. `pnpm build` → PASS (Standalone production build with Serwist service worker)
- **Health Endpoints Verification (`pnpm start`):**
  - `GET /api/health` → `HTTP 200 OK` (`{"status":"ok","timestamp":"2026-10-26T10:56:40.844Z"}`)
  - `GET /api/health/ready` → `HTTP 200 OK` (`{"status":"ready","database":"connected","timestamp":"2026-10-26T10:56:48.379Z"}`)

---

## 12. Push to GitHub and protect `main`

Side task S-03 creates the organization and repo. Then:

```bash
git add -A
git commit -m "chore: add tooling, config skeleton and local database setup"
git remote add origin git@github.com:<your-org>/hesba.git
git push -u origin main
```

In GitHub, under the repo's branch rules for `main`:
- Require a pull request before merging.
- Require the CI checks to pass (CI is created in P1-D-02; add the rule as soon as the CI job exists).
- Block force pushes and deletions.

This is task P0-D-01.

---

## 13. Start the agent (Antigravity)

1. Open the `hesba/` folder in Antigravity. It reads `AGENTS.md` and `.agents/rules/` automatically.
2. Paste **prompt 0** from `docs/07-ops.md` (understanding the project). Read its summary before allowing any code.
3. Then paste this:

```
Implement Phase 1 only, from docs/04-tasks.md, in order.
Start with P1-F-01. After each task, run lint, typecheck, test (and test:int if you touched the database) and report the real results.
Stop at the end of Phase 1 and tell me whether its Done-when condition is met.
```

---

## 14. What is NOT in this file (on purpose)

- Domain name, DNS, and SSL → side tasks S-01 and S-02.
- Hosting, database plans, backups → side tasks S-07, S-10, S-30, S-31.
- SMS, AI, Sentry accounts → side tasks S-05, S-20, S-21.
- Legal text and the lawyer → side task S-06.

These run next to the code. The only gates that block code are listed in `docs/04-tasks.md` with the `⛓` marker.

---

# Part 2: Hosting, Free Tier & Upgrade Path
> Source: formerly `docs/07-ops.md`

> Goal: start at the **lowest possible cost**, and scale up (domain, database, servers) **without users noticing and without losing their data**.
> Figures in tables marked ✔ were verified from the providers' official pages on **2026-10-15**. Free tiers change: **re-verify before any decision**.
> Anything marked ❓ has not been verified yet, and is recorded as a verification task in `04-tasks.md` (P0-D-05).

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
2. **ORM + migrations** (Prisma) — without Prisma Accelerate/Data Proxy.
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

---

## 10. Staging Database (Neon Configuration)

- **Project:** `hesba-staging`
- **Region:** Frankfurt (`eu-central-1`)
- **Branch:** `main` (staging branch)
- **Roles:**
  - `hesba_migrator`: Schema owner and migrations runner (`LOGIN` enabled; `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`). Has `USAGE` and `CREATE` on `public` schema.
  - `hesba_app`: Application runtime pool user (`LOGIN` enabled; `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`). Has `USAGE` on `public` schema, `SELECT, INSERT, UPDATE, DELETE` on existing tables, and default privileges on future objects created by `hesba_migrator`.
- **Connection Configuration:**
  - `HESBA_DATABASE_URL`: Pooled connection string with role `hesba_app`.
  - `HESBA_DIRECT_URL`: Direct connection string with role `hesba_migrator`.
- **Secrets Policy:** Zero connection strings and zero passwords committed or logged; stored strictly in deployment environment / secret manager.

---

## 11. Phase 1 Acceptance

| Acceptance Item | Status | Evidence |
|---|---|---|
| `pnpm dev` runs locally | PASS | Local dev server running, `/api/health` returns `{"status":"ok"}` and `/api/health/ready` returns `{"status":"ready","database":"connected"}` HTTP 200. |
| CI is green on the pull request | PASS | PR #1 (`feature/foundation` -> `main`): all jobs passed (`Code Quality & Unit Tests`, `Database Migrations & Integration Tests`, `Neon Staging Verification`). PR: https://github.com/AhmedMo100/hesba/pull/1 |
| `/api/health/ready` answers on the Neon staging setup | PASS | Neon staging connection verified on GitHub Actions run `40411829827`: returns HTTP 200 `{"status":"ready","database":"connected","timestamp":"2026-10-26T22:23:45.885Z"}`. |
| The shell navigates offline after the first online open | PASS | Playwright E2E suite `tests/e2e/shell-offline.spec.ts` passes (`2 passed in 8.1s`). Verified navigation across all 8 shell views while network offline. |
| The cross-tenant test exists and fails when RLS is turned off | PASS | `tests/integration/cross-tenant.spec.ts` Section 4 ("Negative Proof: Verification that without RLS, isolation fails") executes `assertStoreIsolation` against `devices_unprotected_test`, proving failure (`AssertionError: expected rows to have a length of 1 but got 2`). |
| The market migrations and the seed dry run work | PASS | All migrations applied on local Postgres and Neon staging (`No pending migrations to apply`). Seed validation command `pnpm catalog:import data/catalog/templates/ --dry-run` runs with 0 errors. |

---

# Part 3: Ready-to-Paste Prompts for Antigravity
> Source: formerly `docs/07-ops.md`

> Paste the prompt **as is**. After each reply: **review**, correct, then move to the next step. **One phase at a time.**
> You can talk to the Agent in Arabic. Technical terms in English work better.
> Before starting: make sure `AGENTS.md` and `.agents/rules/` have been read (ask it: "Summarize the project rules from AGENTS.md").

---

## 0) Understanding the project (once, before any code)
```
Read AGENTS.md, then docs/00-index.md, then all the files in docs/ in the order given in 00-index.md.
Do not write any code now.
Summarize for me in short bullet points:
1) What the product is, who the user is, and its principles.
2) The architecture: a single Next.js app, offline, sync, and why Route Handlers rather than Server Actions.
3) The top 10 rules that must never be broken.
4) The map of phases 0–7 and the done-when condition for each.
5) Any conflict, ambiguity, or missing information you found between files (name both files).
6) The open questions in docs/15 that I must decide before Phase 1.
No guessing. If you are not sure, say so.
```
**Review the summary.** If anything is wrong, correct it before continuing.

---

## 1) Phase 1 — Technical foundation
```
Implement Phase 1 only from docs/04-tasks.md (the technical foundation).
Before code: write a short plan (the files you will create, in order, any decision that needs an ADR, and any verification point from docs/08 section 8).
Stop after the plan and wait for my approval.
After approval: implement task by task in order, and after each group of tasks run pnpm lint && pnpm typecheck && pnpm test.
Follow the structure in docs/02-arch.md literally. If you need something outside the structure, write an ADR and ask.
Quote me the actual results of the checks, and do not say "done" without running them.
At the end: compare against the Done-when condition point by point, and tell me what was met and what was not.
```

## 2) Phase 2 — Identity and sync (the riskiest)
```
Implement Phase 2 only (identity, store, and sync) from docs/04-tasks.md.
Re-read: docs/03-data.md, docs/03-data.md, docs/06-quality.md, and docs/02 sections 2 and 4.
First: write a plan + a proposed ADR-0003 (change_log) and ADR-0005 (Service Worker). Wait for my approval.
No periodic polling. Sync is event-driven only. Follow the contract in docs/10 exactly (op types, rejected reasons, 204/401/503/409).
Write the protocol tests (docs/10 section 9) and cross-tenant tests before you say you are done, and work against a real Postgres (Testcontainers), not mocks.
At the end, list anything in the contract you had to change and propose an update to the file.
```

## 3) Phase 3 — Pages (one at a time)
```
Implement from Phase 3 in docs/04-tasks.md this part: [write here: 3.0 Catalog / 3.1 Products+Inventory / 3.2 Selling / 3.3 Expenses+People / 3.4 Alerts+Home].
Visual reference: docs/demo/hesba-demo.html, whose source is docs/demo/src/. Port the look and behavior unchanged. The specs are in docs/05-ui.md.
Rules: text in ar.json, RTL, mobile-first (320/360/390), mandatory states (Empty/Loading/Error/Offline/Pending).
Writes are local in Dexie + Outbox. Shared logic (FEFO/money/units) goes in src/domain with property tests (docs/13 section 2).
Before you finish: a Playwright test of the main flow at 360px + offline, and a light/dark screenshot.
```

## 4) Phase 4 — Reports, AI, subscriptions, and suggestions
```
Implement Phase 4 only. Split it into groups: (a) reports and daily_store_stats (b) subscriptions and payment (c) AI (d) catalog suggestions from docs/06.
Start with (a) and wait for my review before (b), and so on.
Rules: AI numbers come from SQL tools only, and the 5/day limit is enforced on the server with an atomic check. Payment: signed + idempotent Webhooks. Suggestions: never reveal the store's identity or price, and write an identity-leak test.
Any value you guess (limits, caps) must be recorded in docs/15 section 5 and the code marked with // ASSUMPTION.
```

## 5) Phase 5 — Hardening and security
```
Implement Phase 5 only. Reference: docs/06-quality.md, docs/06-quality.md, and docs/05.
Start with: (1) a full security review of every Endpoint/Action, and submit a report of potential vulnerabilities before making changes. (2) A backup restore test. (3) A load test (k6) for a sync storm.
Write runbooks in docs/runbooks (moving the app, moving the database, maintenance mode).
Do not claim that something was tested when it was not.
```

## 6) Phases 6–7 (Alpha/Beta/Launch)
```
Prepare an executable checklist for Phase [6/7] from docs/04-tasks.md: what must be done in code, what is done by humans (visits, support), and the internal support tools required.
Write code for the technical tasks only, and leave the human tasks to me as a list.
```

---

## Ready-made templates for recurring situations

### Code review — after any PR
```
Review the latest changes as a strict reviewer, against AGENTS.md and docs/02, 09, and 10.
Look for: broken RLS or withTenant, polling, Float money, inventory without movements, a non-idempotent Sync operation, data leaks in logs, forbidden imports between client and server, text outside ar.json, a new library without an ADR.
Write the result as: critical issues / important issues / notes, with file and line. Do not change anything until I approve.
```

### Fixing a bug
```
There is a bug: [description + steps + expected and actual].
1) First write a failing test that reproduces the problem. 2) Fix it with the smallest change. 3) Run lint+typecheck+test (+test:int if DB/Sync). 4) Tell me the root cause and what else might follow the same pattern. Do not refactor outside the bug.
```

### Add a small feature (after V1)
```
I want to add: [the feature]. Before any code:
1) Evaluate it against the acceptance rule in docs/14 section 1 (a real need? does it add a step? offline? cost?).
2) If accepted: propose a design with the fewest steps, any changes needed in docs/09/10, and a test plan.
3) Wait for my approval.
```

### If the Agent drifts
```
Stop. You have gone off task/structure. Go back to AGENTS.md and docs/03. What you should be doing is: [the task]. Revert the out-of-scope changes (list them) and continue with the task only.
```

### If there is a conflict between files
```
I found a conflict between [file A] and [file B] on [the point]. Give me: the text from each file, the options, your recommendation, and the impact of each option. Do not implement before I decide. After the decision, update both files and record it in docs/15 section 7.
```

### End-of-phase handover
```
Write an end-of-Phase [N] report: what was done, the done-when condition point by point (✅/❌ with evidence), the actual check results, the new tests, the guessed values added to docs/15, new decisions/ADRs, risks you noticed, and anything deferred and why.
```

---

## Tips for working with Antigravity
1. **Do not give the Agent all the files in one prompt**: it reads them from the project. Point it to the reference by name.
2. **A plan before code**, always, for the risky phases (2, 3.2, 4, 5).
3. **Review the tests themselves**: do they fail if the code is broken? (docs/13 section 11).
4. When the same mistake keeps recurring: **make it a rule** in `.agents/rules/` (after making sure it does not exceed 12,000 characters per file).
5. **Keep it small:** one or two tasks per session is better than a whole phase.
6. **Update `docs/`** after every decision. The documents are the Agent's memory between sessions.
7. If the session gets long and the Agent starts forgetting the rules: start a new session and give it a shortened prompt 0 + the task.
