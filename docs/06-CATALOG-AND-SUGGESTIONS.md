# حسبة (Hesba) — Shared Catalog + Custom Products + Store Suggestions

> The idea: a **public catalog** of the products common in Egyptian supermarkets (we add it manually because there is no API),
> every store can add its own **custom products**, and when one store adds a new product, **the suitable stores** get notified: "There is a product X, want to add it? [إضافة (Add)]".
> A companion file to 02 (Architecture) and 04 (Tasks).

---

## 0. The idea in 6 lines
1. **`global_products`**: the public catalog (readable by everyone, edited by the admin only).
2. **`products`**: the store's products (with price and stock). If the product comes from the catalog → `global_product_id` points to it; if custom → empty.
3. A store can **add a custom product** in seconds (name + unit + price).
4. A custom product is **always recorded in the DB** (this was your request). After an automatic check it becomes a **candidate** (`catalog_candidate`).
5. The candidate reaches **suitable** stores as a suggestion in the alerts: [إضافة (Add)] / [مش محتاج (Not needed)].
6. When enough stores add it (or the admin approves) → it becomes a **public** product in the catalog.

---

## 1. Important decisions (agree on them or change them)

| # | Decision | My suggestion | Why |
|---|---|---|---|
| 1 | **Identity of the store that added it** | **Fully hidden** ("another store"). No name, no area | Privacy + preventing poaching/harassment. Must be written in the Terms (lawyer) |
| 2 | **What is shared** | The product definition only: name, brand, size/unit, category, barcode | Price, stock and sales are **never** shared |
| 3 | **Opt-out option** | The store can say "don't share my custom products" from Settings | Respect for the user + data law |
| 4 | **Who receives the product** | Stores of the **same shop type** (supermarket/grocery/...) that don't have a similar product and haven't rejected it before | Less annoyance and fewer wrong suggestions |
| 5 | **Annoyance limit** | A daily cap per store (adjustable value, e.g. 3) + grouping into one card | "Nothing cluttered" |
| 6 | **Notification** | Inside the app (alerts page + counter). Push optional later (on iOS it needs an installed PWA) | Simplicity + zero cost |
| 7 | **Promotion to a public product** | After **N** acceptances from different stores (N adjustable, starts at 3) **or** admin approval | Prevents chaos |
| 8 | **Duplicate products** | Automatic blocking/merging by barcode and normalized name | A clean catalog |

> **Legal note (to be reviewed with the lawyer):** sharing the product definition between stores + hiding the identity + consent in the Terms.

---

## 2. Data model

```sql
-- كتالوج عام (مقروء للكل، كتابة من الخادم/الإدارة فقط)
-- Public catalog (readable by everyone, written by the server/admin only)
CREATE TABLE global_products (
  id              uuid PRIMARY KEY,              -- uuid v7
  name            text NOT NULL,                 -- as displayed
  name_norm       text NOT NULL,                 -- normalized for search/comparison
  brand           text,
  size_value      numeric, size_unit text,       -- 500 / جم (g)
  category_id     uuid REFERENCES categories(id),
  barcode         text UNIQUE,                   -- optional
  unit_defs       jsonb NOT NULL,                -- units + conversions (piece/carton=12/ ...)
  source          text NOT NULL,                 -- 'seed' | 'promoted'
  status          text NOT NULL DEFAULT 'approved', -- approved | hidden
  catalog_seq     bigint GENERATED ALWAYS AS IDENTITY, -- for incremental sync
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX ON global_products USING gin (name_norm gin_trgm_ops);   -- needs pg_trgm

-- Store products (RLS by store_id)
-- products: id, store_id, global_product_id NULL, custom bool, name, ..., price_minor, deleted_at

-- Catalog candidates (no RLS for stores; server-only access)
CREATE TABLE catalog_candidates (
  id                 uuid PRIMARY KEY,
  submitted_by_store uuid NOT NULL,              -- internal, never shown to any store
  name text NOT NULL, name_norm text NOT NULL, brand text,
  size_value numeric, size_unit text, category_id uuid,
  barcode text, unit_defs jsonb,
  status             text NOT NULL DEFAULT 'pending',
     -- pending | suggestable | approved | rejected | merged | hidden
  accepts_count      int  NOT NULL DEFAULT 0,
  reports_count      int  NOT NULL DEFAULT 0,
  merged_into        uuid REFERENCES global_products(id),
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX ON catalog_candidates (barcode) WHERE barcode IS NOT NULL;

-- Suggestion for a specific store (RLS by store_id)
CREATE TABLE catalog_suggestions (
  id uuid PRIMARY KEY, store_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES catalog_candidates(id),
  status text NOT NULL DEFAULT 'new',            -- new | added | dismissed | reported
  created_at timestamptz DEFAULT now(), acted_at timestamptz,
  UNIQUE (store_id, candidate_id)
);

CREATE TABLE catalog_reports (id uuid PRIMARY KEY, store_id uuid, candidate_id uuid, reason text, created_at timestamptz DEFAULT now());
```
**RLS:** `products`, `catalog_suggestions` by `store_id`. `global_products` is read-only. `catalog_candidates` is locked to stores (server only).

### Normalization (name_norm) — important for Arabic
- Remove diacritics and tatweel (ـ).
- ا/أ/إ/آ → ا · ى → ي · ة → ه (for comparison only).
- Eastern Arabic numerals → Latin.
- Single spaces · lowercase for English.
- Separate the size from the name ("جبنة رومي 500جم" (Roumy cheese 500 g)).
- Put in one shared file `src/domain/normalize.ts` with lots of tests (real examples).

---

## 3. The public catalog: preparing it manually

### Data source (manual, because there is no API)
1. **Google Sheet / CSV** with fixed columns (template in `data/catalog/template.csv`):
   `name, brand, size_value, size_unit, category, barcode, carton_qty, notes`
2. **Filling rules:** a short, clear name · brand separate · unit/size separate · category from a fixed list · barcode if available (not mandatory).
3. **Double review:** two people review before import (catalog mistakes repeat at every store).
4. **Import:** `scripts/import-catalog.ts` (normalizes, checks duplicates by barcode + `pg_trgm`, and outputs a report of similar items instead of merging blindly).
5. **Periodic update:** a version (`catalog_version`) for each import batch.
6. **Priority:** start with the 300–500 most common products (estimated numbers), and grow according to what stores ask for. Stores that can't find a product use "custom product", and that itself feeds the catalog.

### Catalog sync to mobile (offline)
- Dexie table `global_products` (read-only) + an index on `name_norm`.
- `GET /api/sync/catalog?cursor=<catalog_seq>&limit=1000` (incremental, compressed, CDN cache).
- The first download happens once after signup, then small updates.
- **Offline search:** on `name_norm` (prefix + words) from Dexie; if the list is big, a lightweight search library (ADR).
- Within the budget: the total size and Egress are shared (05 section 7).

---

## 4. Flows

### 4.1 Adding a custom product (on mobile — works offline)
```
1) The store searches ← doesn't find it ← "إضافة منتج جديد" (Add a new product)
2) Types: name (required) + unit + price + (optional) brand/size/category/barcode
3) Quick local match against global_products (barcode or name similarity):
     - strong match ← "Is this the same as: [X]? [أيوه، استخدمه] (Yes, use it) [لأ، منتج مختلف] (No, a different product)"
4) Saved in Dexie as products(custom=true) + an op in the Outbox: product.upsert
5) Price and stock **stay private to the store**
```

### 4.2 On the server (when `product.upsert` for a custom product arrives)
```
1) Save it in products (RLS) ✔  ← always
2) If the store has "sharing" enabled:
     a) automatic check:  name length · not digits only · banned-word list (Arabic/English) · not a duplicate
     b) match against global_products/candidates (barcode → name_norm + pg_trgm):
           strong match ← link it to the existing one (don't create a new suggestion)
           no match ← create catalog_candidates (status='suggestable')
3) Job: choose the suitable stores and create catalog_suggestions (section 4.3)
```

### 4.3 Choosing the receiving stores (a Job in `jobs`)
```
Eligible stores =
   same shop_type
   AND doesn't have a matching product (barcode or close name_norm)
   AND no previous suggestion for the same candidate
   AND has suggestion-receiving enabled
   AND hasn't reached its daily cap yet
Order: most active stores first (last use)  ← limited to a max count per candidate (e.g. 50 stores first, then we increase based on acceptance)
```
**Why a small "first wave"?** If nobody accepts the suggestion, we don't bother thousands of stores. If the acceptance rate is high, we expand.

### 4.4 Notification shape (on the alerts page)
```
┌──────────────────────────────────────┐
│ 🛒 محل تاني بيبيع:                    │   (Another store sells:)
│ «اسم المنتج — الحجم»                  │   («Product name — size»)
│ تحب تضيفه عندك؟                      │   (Want to add it to yours?)
│   [ إضافة ]        [ مش محتاج ]   ⋯بلّغ │   ([ Add ]  [ Not needed ]  ⋯Report)
└──────────────────────────────────────┘
```
- **[إضافة (Add)]:** creates a `products` row for you (linked to the candidate/public one), **price empty**, and opens a "حط سعرك" (Enter your price) field (the price is not transferred), stock zero.
- **[مش محتاج (Not needed)]:** `dismissed` (never comes back).
- **بلّغ (Report):** offensive/wrong product → `reports_count++`.
- All of it works offline: the decision is saved in the Outbox (`suggestion.accept` / `suggestion.dismiss`).
- Grouping: if there is more than one suggestion, a single card "3 منتجات جديدة" (3 new products) that opens up.

### 4.5 Promotion to the public catalog
```
On suggestion.accept: accepts_count++
If accepts_count ≥ N (from different stores)  OR  the admin approved:
     create global_products(source='promoted') + link the candidate (merged)
     Stores that already added it are switched to global_product_id automatically (Job)
If reports_count ≥ K or the admin rejected it: status='hidden'
```

### 4.6 Admin panel (simple, later phase)
`/admin/catalog` (protected by the `platform_admin` role): list of candidates + merge/reject/approve + reports + acceptance statistics. Every operation goes in `audit_log`.

---

## 5. Protection from abuse and annoyance
| Risk | Solution |
|---|---|
| A store floods the catalog with fake products | A daily limit per store + automatic check + the first X products from a new store are reviewed manually |
| Offensive content | Word list + "بلّغ (Report)" button + automatic hiding at K reports |
| Duplicate products | Unique barcode + `name_norm`/`pg_trgm` matching + merging by the admin |
| Annoying stores | Daily cap + same shop type only + small first wave + grouping |
| Revealing the store's identity | The API never returns `submitted_by_store` + a security test verifies it |
| Price manipulation | **Prices aren't shared at all** |
| Dexie abuse (huge catalog) | Size limit + incremental download + no images in V1 |

---

## 6. Performance and cost (related to 05)
- The public catalog: long `Cache-Control` + ETag + cursor → reduces Egress and invocations.
- Choosing the receiving stores: a **batched Job**, not at request time.
- Suggestions for the store: pulled with the regular `pull` (no polling).
- Indexes: `pg_trgm` on `name_norm` + `barcode` UNIQUE.

---

## 7. Required tests
1. Arabic normalization (30+ real examples: hamzas, ya/alef maqsura, ta marbuta, digits).
2. **Leak prevention:** no Endpoint returns the sending store's identity.
3. **RLS:** a store can't see another store's `catalog_suggestions`.
4. Duplicates: the same product from two stores at the same moment (concurrency) = one candidate.
5. Offline: adding a custom product + accepting a suggestion without internet, then syncing.
6. Price: accepting a suggestion **doesn't copy** any price.
7. Limits: daily cap for suggestions and additions.
8. Promotion to the public catalog: reaching N acceptances switches the stores automatically without losing sales/stock.

---

## 8. Risks
| Risk | Impact | Action |
|---|---|---|
| The initial catalog has errors | Repeats at every store | Double review + small batches + `catalog_version` + a quick Hide option |
| Many low-quality suggestions | Stores ignore notifications | First wave + monitoring the acceptance rate + tuning the filters |
| A legal problem with sharing | The feature is stopped | Explicit consent + hidden identity + opt-out option + lawyer review |
| Wrong matching (merging two different products) | Wrong stock/accounts | **We never link automatically except by barcode or a strong match**, and for the rest we ask the user |
| The catalog grew on a weak phone | Slowness | Incremental download + a light index + a limit |

---

## 9. Product notes
- The button name: **"إضافة" (Add)**. ("وصلت" means "the message arrived"; the most suitable for the user is one clear word.)
- After acceptance: a short message "اتضاف. حط سعرك" (Added. Enter your price) with automatic focus on the price field.
- The main products page: a "اقتراحات" (Suggestions) tab next to "المنتجات" (Products) instead of cramming everything into the alerts (possibly an ADR later).
