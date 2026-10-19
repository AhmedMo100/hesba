# Hesba (حسبة) — Project Setup: From Zero to the First Commit

> Do this once, before Phase 1 work starts. It creates the repo, scaffolds the single Next.js app, installs the dependencies, and proves that the local environment runs.
> **Domain, hosting, providers and accounts are NOT here.** They are in the side track (`docs/04-TASKS.md`, section S). Do not wait for them to start this file.
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
  drizzle-orm postgres @node-rs/argon2 uuid pino \
  serwist @serwist/next
```

**4.2 Development and quality**
```bash
pnpm add -D drizzle-kit tsx \
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

Create the top-level folders now. The inner folders follow `docs/03-FOLDER-STRUCTURE.md` exactly, and are created in task P1-F-01.

```bash
mkdir -p src/client src/server src/domain src/schemas \
  drizzle data/catalog scripts tests public/fonts \
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
| `drizzle.config.ts` | Migrations folder `drizzle/`, URL from `HESBA_DIRECT_URL` (direct, not pooled) |
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
-- Migrations owner (runs drizzle migrations, owns the tables)
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
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
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
2. Paste **prompt 0** from `docs/16-AGENT-PROMPTS.md` (understanding the project). Read its summary before allowing any code.
3. Then paste this:

```
Implement Phase 1 only, from docs/04-TASKS.md, in order.
Start with P1-F-01. After each task, run lint, typecheck, test (and test:int if you touched the database) and report the real results.
Stop at the end of Phase 1 and tell me whether its Done-when condition is met.
```

---

## 14. What is NOT in this file (on purpose)

- Domain name, DNS, and SSL → side tasks S-01 and S-02.
- Hosting, database plans, backups → side tasks S-07, S-10, S-30, S-31.
- SMS, payments, AI, Sentry accounts → side tasks S-05, S-20, S-21.
- Legal text and the lawyer → side task S-06.

These run next to the code. The only gates that block code are listed in `docs/04-TASKS.md` with the `⛓` marker.
