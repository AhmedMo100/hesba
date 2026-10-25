# حسبة (Hesba) — Folder & File Structure (Next.js single app)

> **A single package** (not a monorepo), a Next.js (App Router) app containing both the frontend and the server. **Antigravity:** creating folders/files outside this structure is forbidden without an ADR.
> ✱ = created in a specific phase (the number = the phase in 04-TASKS.md).

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
├── 04-TASKS.md  05-HOSTING-FREE-TIER-AND-UPGRADE-PATH.md  06-CATALOG-AND-SUGGESTIONS.md
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
- Read AGENTS.md, then docs/00-START-HERE.md (the order), and all files in docs/ before any task. Work on one phase only at a time (from 04-TASKS.md).
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
