# Restructuring Change Report

- **Branch:** `refactor/production-architecture` (base commit `6118a85`). Nothing is committed and nothing is staged.
- **Scope:** the uncommitted restructuring (ADR-0017, phases A–F), measured from the working tree against `HEAD`.
- **Method:**
  - Rename-aware `git diff -M50% --name-status HEAD`, computed through a throwaway index file, so the real index was never touched.
  - For each renamed file, a line-level diff against the original path.
  - A comment-stripped comparison using the TypeScript printer to prove which edits were comment-only.
- **Separation of work:** the documentation task that followed is reported separately in §9. A working-tree snapshot (status plus SHA-1 of every changed file) was taken before that task began.

---

## 1. Summary

| Metric | Count |
|---|---|
| Paths changed (rename-aware) | **106** |
| Moved/renamed | **44** (20 byte-identical moves, 24 moves with import-path edits only, or import edits plus code moved out) |
| Added | **20** (plus `tenancy.service.ts`, which git shows as delete + add — see §3.3) |
| Deleted | **3** |
| Modified in place | **39** (24 in `src/`, 10 in `tests/`, 5 docs/config) |
| Consolidations | **3** (see §4) |
| Line totals | +2,700 / −1,202, including new tests and docs |

**No file was removed as unused.** `AdjustStockModal.tsx` (no references anywhere) was moved, not deleted, because the owner chose "report only" for removals. The 3 deletions are consolidations or the tenancy rename.

---

## 2. New structure and dependency direction

```
src/app/          Routes only. Handlers: zod parse → requireSession → one module call → toSafeErrorResponse
src/client/
  app-shell/      Shell, navigation, sync bar, lazy view registry
  features/<f>/   One folder per screen (home, sales, products, stock, people, expenses, alerts, ai, auth)
  offline/        Dexie database + catalog sync/search
  shared/         Used by ≥2 features: api/ (HTTP clients), auth/ (AuthProvider), store-items.ts, ui/, styles/, hooks/, i18n/, theme/
src/domain/       Pure rules (no DB/framework/React). New: alerts.ts
src/schemas/      zod contracts. New: sale.ts, promotion.ts (+ customTaxonomyInputSchema in product.ts)
src/server/
  config/         env.ts
  platform/       logger, errors
  infra/          db, crypto, email, ai (NEW: model + web-search adapters)
  modules/<m>/    index.ts public API + *.service.ts. NEW modules: sales, promotions, alerts
```

**Dependency direction:**
- `app → server/modules (index only) → infra/platform → domain/schemas`
- `client: app-shell → features → (shared, offline) → domain/schemas`
- `domain` and `schemas` import nothing from app, client or server.

**ESLint rules** (`eslint.config.mjs`):

| Rule | Status |
|---|---|
| `client` ✗ `server` | Existing |
| `domain/schemas` ✗ `client/server/app` | Existing |
| `domain`, `schemas` ✗ `@prisma/*`, `next`, `react`, `dexie`, `server-only` | **New** |
| `client/shared`, `client/offline` ✗ `features/*`, `app-shell/*` | **New** |
| `src/app`, `src/server/modules` ✗ `@/server/modules/*/*` (deep imports) | **New** |

Each new rule was proven to fire with a deliberate violation sent through `eslint --stdin`, and a legitimate barrel import passes.

**Architectural rules recorded in ADR-0017 (status: Proposed):**
- Feature-local code stays in its feature; shared types and API clients go to `shared/`.
- One feature may render another's modal only by file path. No component barrels, to protect lazy-chunk splitting.
- `offline/` never imports features.

---

## 3. File-by-file changes

### 3.1 Client: pure moves (byte-identical, R100)

| Original | Current | Notes |
|---|---|---|
| `client/app-shell/views/{Ai,Alerts,Expenses,Home,People,Products,Sales,Stock}View.module.css`, `EditPromoModal.module.css` | `client/features/<feature>/` | Styles unchanged |
| `client/app-shell/views/ViewLayout.module.css` | `client/shared/styles/ViewLayout.module.css` | Used by Sales and Expenses |
| `client/shared/auth/{AuthScreen,ProfileModal}.module.css` | `client/features/auth/` | — |
| `client/shared/db/{index,schema,types}.ts` | `client/offline/db/` | Dexie database |
| `client/shared/catalog/{index,catalog-search,catalog-sync}.ts` | `client/offline/catalog/` | Catalog cache |
| `client/app-shell/views/customTaxonomy.ts` | `client/shared/api/custom-taxonomy.ts` | Renamed to kebab-case; used by products and stock |
| `client/shared/machines.ts` | `client/shared/api/machines.ts` | Used by 5 features |

- **Public API:** unchanged.
- **Behavior change:** none.
- **Risk:** import resolution only. Verified by typecheck, build and unit tests.

### 3.2 Client: moves with import-path edits

Only import lines changed in all of these. Verified by diff: zero non-import lines differ, except in the two views listed after the table.

| Original | Current | Owner / responsibility |
|---|---|---|
| `app-shell/views/AiView.tsx` | `features/ai/AiView.tsx` | AI chat screen |
| `app-shell/views/AlertsView.tsx`, `EditPromoModal.tsx` | `features/alerts/` | Alerts + promo editor (EditPromoModal also used by sales) |
| `shared/auth/AuthScreen.tsx`, `ProfileModal.tsx` | `features/auth/` | Login/signup/recovery screens, profile modal |
| `app-shell/views/ExpensesView.tsx` | `features/expenses/` | Expenses |
| `app-shell/views/HomeView.tsx` | `features/home/` | Dashboard |
| `app-shell/views/PeopleView.tsx` | `features/people/` | Customers, payables, suppliers |
| `app-shell/views/ProductsView.tsx`, `ProductFormModal.tsx`, `MachinesModal.tsx`, `ServiceFormModal.tsx` | `features/products/` | Product list and forms. Machine modals live here because only ProductsView opens them and they use its CSS. |
| `app-shell/views/SalesView.tsx` | `features/sales/` | Sales screen |
| `app-shell/views/StockView.tsx`, `AddStockModal.tsx`, `EditStockModal.tsx`, `AdjustStockModal.tsx`, `ArchiveStockModal.tsx`, `ClearStockModal.tsx`, `MachineTopupModal.tsx` | `features/stock/` | Stock screen and modals |

**Two views changed beyond imports:**
- **`ProductsView.tsx`:** 43 lines removed, namely the `StoreProductItem` interface and `isServiceProduct`, which moved verbatim to `shared/store-items.ts`, plus their import line.
- **`StockView.tsx`:** 34 lines removed, namely the `StockInventoryItem` interface, moved verbatim to the same file.

These two moves also break real import cycles. Before:
- `StockView` and `{Edit,Adjust,Archive,Clear}StockModal` imported each other.
- `ProductsView` and `AddStockModal` imported each other.

**Other facts:**
- **Public API:** the types are now imported from `@/client/shared/store-items`. Their shapes are unchanged.
- **Dead file:** `AdjustStockModal.tsx` (650 lines) has no references in src, tests or docs. It was moved, not deleted.
- **Tests:** unit specs `products-view`, `sales-view`, `stock-view`, `ai-view`, `auth`, `people-i18n` (paths updated); e2e `shell-offline` (mobile passes).

### 3.3 Server

| Original | Current | Change | Public API / behavior |
|---|---|---|---|
| `modules/ai/providers/{gemini,mock-ai}.provider.ts`, `modules/ai/search/{brave-search,mock-search}.provider.ts` | `server/infra/ai/` | Moved to infra. Imports now point to `./contracts`. The Gemini constants `DEFAULT_GEMINI_MODEL` and `GEMINI_API_BASE_URL` moved into `gemini.provider.ts` (same values). | **API change:** the provider classes and the two Gemini constants are no longer exported from `@/server/modules/ai`. They are exported from `@/server/infra/ai`. Only tests used them. No behavior change. |
| `modules/ai/providers/ai-provider.interface.ts`, `modules/ai/search/search-provider.interface.ts` | **deleted** → merged into `infra/ai/contracts.ts` | Consolidation, see §4 | Same interfaces |
| `modules/tenancy/service.ts` | `modules/tenancy/tenancy.service.ts` | Renamed for naming consistency, plus **added** `readStoreSettings` / `updateStoreSettings` / `StoreSettings` | Additive |
| `modules/ai/types.ts` | same | Vendor types now re-exported from `infra/ai`; `AIQuotaStatus` kept | Same exported names |
| `modules/ai/index.ts` | same | Removed the provider re-exports | See the first row |
| `modules/ai/constants.ts` | same | Removed the two Gemini constants | See the first row |
| `modules/ai/ai.service.ts` | same | Imports providers from `infra/ai` | None |
| `modules/{catalog,machines,inventory,people}/index.ts`, `catalog/constants.ts`, `people/types.ts` | same | Added `import "server-only"` | Build-time guard only |
| `modules/catalog/index.ts` | same | Also exports the new `custom-taxonomy.service` | Additive |
| `modules/tenancy/index.ts` | same | Re-exports `./tenancy.service` | Same names plus new helpers |
| `infra/db/tenant.ts` | same | JSDoc only | None |

**New files:**
- `infra/ai/{contracts,index}.ts`
- `modules/sales/{index,sales.service,sales-config.service}.ts`
- `modules/promotions/{index,promotions.service}.ts`
- `modules/alerts/index.ts`
- `modules/catalog/custom-taxonomy.service.ts`

### 3.4 Business logic extracted from route handlers

| Logic | Previously | Now | Preserved? | Evidence |
|---|---|---|---|---|
| Sales list / record / delete | `app/api/sales/route.ts` (271 lines, raw `tx.sale`) | `modules/sales/sales.service.ts`; schema in `schemas/sale.ts` | Yes, code copied verbatim | `tests/integration/sales-api.spec.ts`, written and run **before** the move: 6 pass + 4 `it.fails` (defect K1) both before and after |
| Sales-screen config | `app/api/sales/config/route.ts` | `modules/sales/sales-config.service.ts` | Yes | `store-settings-api.spec.ts`: 7/7 before and after |
| Published promotions | `app/api/promotions/route.ts` | `modules/promotions/`; schema and types in `schemas/promotion.ts` | Yes. The JSON round-trip on write is kept. | `promotions-api.spec.ts`: 5/5 before and after |
| Alerts classification and clearance offers | `app/api/alerts/route.ts` (278 lines) | Pure `domain/alerts.ts` plus `modules/alerts/index.ts` | Yes, verbatim. Literals became named constants with the same values; `now` became an injectable parameter (default = current time). | `tests/unit/domain/alerts.spec.ts` (6 new tests). No pre-move characterization test existed for this route. |
| Custom taxonomy | `app/api/store/custom-taxonomy/route.ts` | `modules/catalog/custom-taxonomy.service.ts`; schema in `schemas/product.ts` | Yes | `store-settings-api.spec.ts` |
| Client types imported from route files | `@/app/api/{promotions,alerts}/route` | `@/schemas/promotion`, `@/domain/alerts` | Same shapes | typecheck |

**Behavior notes:**
- **One intentional serialization change:** the sales-config and custom-taxonomy writes now go through `updateStoreSettings`, which JSON round-trips the settings object (it drops `undefined` values). The stored values in those paths are strings and arrays, so the stored result is identical, and the tests confirm this.
- **Cron routes:** they now read `HESBA_CRON_SECRET` through the validated `env`. If the variable is missing, both before and after the response is a 500. `catalog-promotion` also imports through the catalog barrel.

### 3.5 Tests

- **New integration specs:** `sales-api`, `promotions-api`, `store-settings-api`, `profile-api`. The profile spec pins K4 with `it.fails`. The profile route itself was **not** changed.
- **New unit spec:** `tests/unit/domain/alerts.spec.ts`.
- **Modified (import paths only):** 9 client unit specs and `tests/unit/server/ai-tools.spec.ts`.
- **No test was deleted or weakened.**

### 3.6 Documentation

| File | Change |
|---|---|
| `docs/adr/0017-production-folder-structure-and-module-shape.md` | New, status **Proposed** |
| `docs/02-arch.md` | Part 1 §3.2 and §4.1, Part 2 §3 and §4 updated to ADR-0017; one stale `shared/db` reference fixed |
| `AGENTS.md` §5 | Import-boundary sentence updated to the `features` layout |
| `docs/01-product.md` | Added O17 and table §2.1 "Known defects K1–K10"; ADR-0017 row; change-log row |
| `.agents/skills/offline-sync/SKILL.md` | Two paths updated (`offline/db`, `offline/sync`) |

---

## 4. Consolidations

| Original | Result | Reason | Public API |
|---|---|---|---|
| `ai-provider.interface.ts` (15 lines) + `search-provider.interface.ts` (19 lines) + vendor types in `ai/types.ts` | `infra/ai/contracts.ts` | One cohesive vendor contract, used only by the AI adapters and module | Same names, re-exported from `ai/types.ts` |
| Store-settings read-modify-write duplicated in promotions, sales/config and custom-taxonomy routes | `tenancy.service.ts`: `readStoreSettings`, `updateStoreSettings` | Four copies of one operation owned by the store | New exports |
| Gemini constants in `ai/constants.ts` | Inlined in `gemini.provider.ts` | Single consumer | Removed from the AI barrel |

---

## 5. Planned but not done

- **Large views:** no split of SalesView (2,027 lines), ProductFormModal, ProductsView, PeopleView, AddStockModal, StockView or AuthScreen.
- **Inventory:** no `*.repo.ts` extraction, and no split of `inventory.service.ts` or `catalog.service.ts`.
- **Service construction:** 16 routes still build `new XService(prisma)`.
- **Profile route:** not extracted (K4).
- **Rename:** `middleware.ts` is not renamed to `proxy.ts`.
- **Hard-coded Arabic:** no extraction into `ar.json`.
- **Duplicates:** the three `normDigits` variants were not merged.
- **Dependency tooling:** no circular-dependency tool was run.

---

## 6. Discrepancies between the previous completion report and the repository

| Previous report said | Repository shows |
|---|---|
| "40 modified, 47 deleted, 21 untracked" | Those were raw `git status` counts, which list each move as a delete plus an untracked file. Rename-aware: 44 renamed, 39 modified, 20 added, 3 deleted. |
| "Tests turned up **4** production bugs … most serious: [3 listed]" | The fourth was **K7**: the alert clearance offer priced above the original, pinned by `tests/unit/domain/alerts.spec.ts`. It's real but low severity, which is why it wasn't highlighted. K5 was a pre-existing failure, not found by the new tests. |
| "`syncCatalog` / `searchOfflineCatalog` never called" (audit) | `searchOfflineCatalog` **is** called by `ProductFormModal`. `syncCatalog` is not called by any screen. |
| K6 "UUID v7 ids not recognized" | The regex does reject v7, but every database id is generated by `gen_random_uuid()` (v4). Not reproducible with current data; latent only. |
| Audit: "`postgres` dependency unused", "`public/sw.js` tracked" | `postgres` is used by the integration tests. `public/sw.js` is gitignored. |
| Audit: "dummy password hash may break timing protection (unverified)" | Now **verified**: the dummy hash fails to decode in ~0.05 ms vs ~10 ms for a real verify. |

---

## 7. Verification of the restructuring

| Check | Result |
|---|---|
| lint, typecheck, `pnpm build` | Pass |
| Unit tests | 273/273 |
| Integration tests | 161 pass, 5 expected-fail (K1 ×4, K4 ×1), 1 fail |
| E2E tests | 15 pass, 1 fail |

- **Integration failure:** `inventory-stock` adjust delta (K5). It fails identically on the baseline before any change.
- **E2E failure:** desktop `shell-offline`. Two visible buttons share `aria-label="التنبيهات"` (Header bell, added in commit `3d9216e`, plus the SideNav item). Neither file was changed. No pre-change e2e baseline was run, so this attribution rests on the cause.

---

## 8. Not verified

- No circular-dependency scan.
- No e2e baseline before the restructuring.
- No bundle-size comparison before/after. The lazy chunk paths changed; the build succeeded.

---

## 9. Documentation task (comments only) — files changed

Each file below received comments only. **Proof:**
- **28 files** were clean at the task baseline. After stripping comments with the TypeScript printer, each is byte-identical to `HEAD`.
- **8 files** were already modified by the restructuring. After stripping comments, their only differences from `HEAD` are the restructuring's import and lazy-`import()` path changes.
- **`sales.service.ts`** has no `HEAD` version. Its edits replaced comment text only.

**Server:**
- `auth/{session,login,signup,password,forgot-password}.service.ts`, `auth/rate-limiter.ts`
- `infra/db/client.ts`, `infra/crypto/card-encryption.ts`
- `platform/error.ts`, `platform/logger.ts`, `config/env.ts`
- `inventory/inventory.service.ts`
- `catalog/{catalog,community-suggestions}.service.ts`
- `expenses/expense.service.ts`, `machines/machines.service.ts`
- `people/{people,customer,payable,supplier}.service.ts`
- `ai/{ai,quota,conversation}.service.ts`, `ai/tools/business-tools.ts`
- `sales/sales.service.ts`

**Domain:** `commission.ts`, `wallet.ts`, `product-matcher.ts`.

**Client:**
- `app-shell/{AppShell,SyncBar}.tsx`
- `shared/auth/AuthProvider.tsx`, `shared/api/machines.ts`
- `offline/db/schema.ts`, `offline/catalog/{catalog-sync,catalog-search}.ts`
- `features/sales/SalesView.tsx`, `features/home/HomeView.tsx`

**Notable comment corrections:**
- **`machines.service.ts`:** its old comment claimed the deduct "atomically checks balance". Corrected to describe read-then-write without a lock.
- **`sales.service.ts`:** the header's "KNOWN DEFECTS" status list was replaced with factual behavior notes; status now lives in the audit docs.

**Not covered:** UI primitives, theme/hooks, most feature views beyond Sales and Home, schemas, email providers, and scripts.
