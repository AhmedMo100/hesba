# ADR-0036: Two packages again, linked accounts, services as a management page, a simpler stocktake

- **Status:** Accepted
- **Date:** 2026-11-25
- **Decision-maker:** Ahmed Tarek / Team Hesba (owner's decisions of 2026-11-24)
- **Supersedes:** ADR-0035 §1 (one package) and §3 (services page with money). ADR-0035 §2
  (Home as the hub), §4 (one commission rule per service), §5 and §6 stay, as amended below.
- **Amends:** ADR-0033 (reports per mode), ADR-0034 (stocktake reasons)

## Context

PR #48 turned every shop into الكاشير الذكي. The owner reversed that decision. He also asked for:

- reports that keep their design, each package reading its own periods;
- customer and supplier accounts linked to the invoices and their products, with manual debts
  that can list products;
- a services page that only manages services (fixed or percentage commission);
- a card-only «فلوس حِسبة»;
- a stocktake that is even simpler.

## Decision

### 1. Two packages: إدارة المحل (default) and الكاشير الذكي

- **Sign-up:** the package is chosen on the sign-up screen and required by the API. The owner
  switches it from the store menu. This is ADR-0033, restored.
- **The single-package migration is removed.** `20261124000000_single_package` was never
  applied to Neon dev or production; it ran on a local test database only. Removing it rewrites
  no shop's mode, and nothing has to be guessed back.
- **Where the package shows:**

  | Place | إدارة المحل | الكاشير الذكي |
  | --- | --- | --- |
  | Home «بيع حاجة» | the daily total | the cashier |
  | Home profit card | «ربحك الشهر ده» | «ربحك النهارده» |
  | Reports | whole months | single days |

### 2. Report periods per package (`src/domain/report-periods.ts`)

- **إدارة المحل:** «الشهر ده» (from the 1st), «الشهر اللي فات», or a chosen month. A month is sent
  as `period=custom` with its first and last day (today for the current month).
- **الكاشير الذكي:** «النهارده», «امبارح», or a chosen day (`period=custom`, `from` = `to`).
- **Server enforcement:** `GET /api/reports/home` and `/api/reports/export` refuse any other
  period with 403 and an Arabic reason.
- **Not restricted:** the AI tools read the report service directly, unchanged.
- **The reports page:** sections, order and numbers are unchanged. Export and share are two
  small icons. Both use the same server Excel file: downloaded, or handed to the phone's share
  sheet with the summary.

### 3. Accounts linked to invoices and products

- **A credit sale** («بيع حاجة») and **a credit purchase** («دخلت بضاعة») each write ONE debt on
  their invoice, as before. Their payments settle it; a payment is never a sale or a purchase.
- **«كشف الحساب»** (`GET /api/people/:id/statement`, read-only) lists every entry with:
  - its source: an invoice, the daily total's credit, a manual debt, a payment, an adjustment;
  - its products, as quantity × price = total;
  - the running balance and a button that opens the original invoice.
- **A manual debt may list products** (`debt_entry_items`).
  - **Each line:** product (from the shop's list, or typed), quantity, agreed price; also the
    date and a note.
  - **The total:** the server computes it and refuses a typed amount that differs.
  - **Accounting:** written on the account only. It is labelled «دين يدوي» and is not an
    invoice. It moves no stock, adds no revenue and moves no money.
  - **Safety:** another shop's product is a 404, and products on a payment are a 400.
  - **الكاشير الذكي:** the sheet also offers the existing credit invoice, which takes the stock.

### 4. «الخدمات والعمولات» manages services only

- **The page:**
  - «+ أضف خدمة» (the same look as «+ جديد» on «بضاعتي»);
  - a category filter;
  - small cards with edit and delete.
- **The commission** is a fixed amount, a percentage, or tiers by amount. It is still ONE rule
  per service, in `salesConfig.serviceCommissions` (the API now accepts a rule without tiers).
- **History:** each operation keeps the commission it was charged. Deleting a service hides it;
  its past operations stay.
- **Money moved out:** machines, wallets and transfers are in «فلوس حِسبة», and
  `/app/alerts` opens it.
- **Recording an operation** in إدارة المحل (no cashier) moved to its own page,
  `/app/service-ops`, linked from the bottom of the services page.

### 5. «فلوس حِسبة»: cards

- **The cash:** its own colour. It is never charged by hand.
- **Machines and wallets:** cards side by side, each with a small menu: top up, rename, delete.
- **Buttons:** «+ ماكينة» and «+ محفظة». A wallet is marked by `provider = 'محفظة'`.
- **Transfers and withdrawals** open a small form. The latest movements sit in a collapsed
  section.
- **Balances** are read from the server each time the screen opens, so an operation done on any
  other screen shows at once.

### 6. The stocktake

- **«الجرد»:**
  - the unfinished count's summary;
  - one big «اعمل جرد جديد»;
  - past counts, with a filter (الكل · اتطبّق · اتلغى).
- **Counting, one product per screen:** «العدد في حِسبة: 20», «عدّ الموجود عندك: [ 17 ]».
- **A shortage** asks «الـ 3 قطع دول حصل فيهم إيه؟»:
  - اتباع ومتسجلش;
  - تالف;
  - **منتهي الصلاحية** (new `expired` reason: a loss in `waste_records` as expired, counted
    once);
  - مفقود;
  - سبب آخر.

  Damaged, expired and «سبب آخر» take a note (`inventory_count_lines.note`).
- **A surplus** asks where it came from. The answer is saved as the note; the line is still a
  stock adjustment, never a purchase.
- **«اتباع ومتسجلش»** keeps each package's rule (ADR-0034). The screen states it before
  confirming:
  - الكاشير الذكي: a sale the count discovered;
  - إدارة المحل: the money is already in the daily total.
- **The summary** shows:
  - products counted, short and over;
  - how many are damaged, expired or sold unrecorded;
  - the value of the differences.

## Migration

`20261125000000_debt_items_and_count_notes` is additive only. It:

- creates `debt_entry_items` (FORCE RLS, tenant policy, append-only for `hesba_app`);
- adds `inventory_count_lines.note`;
- widens the reason CHECK to include `expired`.

No existing row changes. It is not applied to Neon dev or production by this change.

## Consequences

- **Kept:** no table, business rule or working screen was removed. The sales, stock, expenses,
  products, AI and alerts screens are unchanged.
- **Pending on Neon dev / production**, in order:
  - `20261123000000_stocktake_money_services`;
  - `20261125000000_debt_items_and_count_notes`.
