# ADR-0035: One package, Home as the hub, one commission rule per service, a step-by-step stocktake

- **Status:** Accepted, partly superseded by ADR-0036 (§1 one package and §3 the services page
  with money are reversed; §2, §4–§6 stay as amended there)
- **Date:** 2026-11-24
- **Decision-maker:** Ahmed Tarek / Team Hesba (owner's decisions of 2026-11-23)
- **Amends:** ADR-0033 (operating modes), ADR-0032 / ADR-0034 (service commission rules),
  ADR-0034 (stocktake screen)

## Context

Hesba is for small Egyptian grocery owners, many of whom rarely use technology. The product had
grown two "packages" (إدارة المحل / الكاشير الذكي), a dashboard-style Home with a sidebar on
desktop, two places to set a service's commission, and a stocktake screen that showed every
product at once. The owner asked for a much simpler product, without weakening the accounting
or the security.

## Decision

### 1. One package: الكاشير الذكي

- **New shops:** sign-up shows no package choice. The server always creates the shop as `pos`.
  An older client's `operatingMode` field is accepted and ignored.
- **Mode route:** `PATCH /api/store/operating-mode` accepts `pos` only.
- **Existing shops:** migration `20261124000000_single_package` moves shops on إدارة المحل to
  `pos`.
  - Only `operating_mode` and `operating_mode_changed_at` change.
  - `stores` has FORCE RLS and the migrating role has no BYPASSRLS. The table owner therefore
    lifts FORCE and puts it back inside one atomic `DO` block.
  - Past daily totals stay in the reports. Past stocktakes keep the mode they were confirmed in
    (`inventory_counts.operating_mode`), so their history is not rewritten.
- **Kept for history, not offered:** the `'simple'` value, the daily-sales tables and their
  read endpoint.
- **Plans:** subscriptions are unchanged (`subscription_plan` stays internal). No plan is ever
  shown or compared.

### 2. Home is the hub; no sidebar, no bottom bar

- **Top:** «أهلاً بيك» and the logout button.
- **Two numbers:**
  - «فلوس المحل»: `GET /api/money`, the drawer from its last count plus every machine.
  - «ربحك الشهر ده»: `profit` of `GET /api/reports/home?period=month`. That is goods profit +
    service commissions − operating expenses − losses, labelled «تقريبي» when estimated and
    «—» when the data is not enough. It is never sales − expenses.
  - Each number shows a skeleton while loading, and on failure «حصلت مشكلة · جرّب تاني» with a
    retry. There is no default number.
- **Actions:** دخلت بضاعة · صرفت فلوس · بيع حاجة · حسابات الناس · بضاعتي ·
  الخدمات والعمولات · اسأل حسبة.
- **Stocktake:** «اعمل جرد» is a floating button, not another card.
- **Inner screens:** a large labelled «→ رجوع» in the header.
- **Desktop:** the same layout, wider (760 px), with no sidebar.
- **Requests:** Home makes three (money, month report, stock for the first-run hint), down from
  three plus the drawer.

### 3. «الخدمات والعمولات» gathers services, commissions and money

- **Three tabs:** «سجّل عملية», «الخدمات», «فلوس حِسبة».
- **«فلوس حِسبة»** is the same component as the «فلوس حِسبة» screen. The drawer cannot be
  topped up by hand. Each machine or wallet is a card with top-up (the existing form), rename,
  delete, plus add, transfers and personal withdrawal.
- **The old page:** the stand-alone «المحافظ والماكينات» page and its home card are gone.
  `/app/alerts` opens the «فلوس حِسبة» tab.

### 4. One commission rule per service

- **The service** is the shop's service product: the one the cashier sells.
- **Its rule** is the one in `salesConfig.serviceCommissions` (slabs, saved by the existing
  service form).
- **Both paths use it:** the cashier and «سجّل عملية» (`serviceRuleOf`) read the same rule.
- **Retired:** `settings.serviceRules` and `PUT /api/services/rules`.
- **History:** every operation still stores its commission, so later rule changes never rewrite
  history.
- **Money model:** both directions use the cashier's model.
  - Send: the customer pays a + c and the float goes −a.
  - Receive: the float goes +a and the customer gets a − c.
  - Only c is income. Example: the customer pays 500 and the machine pays out 490, so the
    commission is 10.
- **Safety:** both machines are checked to belong to the shop before anything is written. A
  product that is not a service, or another shop's service, is refused.
- **Summaries:** the services summary (page, AI) also counts cashier service sales as
  paid − machine charge.
- **Reports:** they show cashier service sales apart from goods sales
  (`sales.serviceSalesPiasters`).

### 5. «اعمل جرد»: one thing per screen

1. **Resume or restart:** an unfinished count? «تكمل من حيث وقفت؟» → أكمل الجرد / ابدأ جرد جديد.
   Starting over cancels the open count, with no stock change.
2. **Scope:** كل المحل / قسم / منتجات معينة.
3. **Counting:** one product at a time (المتوقع, الفعلي, التالي), with progress and what is left.
4. **A difference:**
   - المتوقع / الموجود / الفرق, then «ليه حصل الفرق؟»: تالف · مفقود · اتباع ومتسجلش ·
     خطأ في العد · سبب آخر.
   - «خطأ في العد» is not stored: the owner counts again. The owner always chooses the reason.
5. **Applying:** summary → «راجع الجرد» → «تطبيق الجرد» → an explicit confirmation («بعد
   التطبيق مش هتقدر تعدّل الجرد ده»). Only then does the server apply it, atomically and once.
   «إلغاء» changes nothing.
6. **The report:**
   - **Contents:** date, who started and closed it, scope, expected / actual / differences /
     reasons / values / applied cost.
   - **Formats:** downloaded as CSV or shared (text + file) from the phone
     (`client/shared/share.ts`).

The server rules of ADR-0034 are unchanged: a confirmed count is frozen, it records who and
when, and its movements carry the confirm op.

### 6. «اسأل حسبة» helps; it never acts

- **Stays general:** the assistant still answers any question about the shop.
- **Stocktake:** «عايز أعمل جرد» explains the steps and offers «افتح اعمل جرد». It works in
  both modes; the private mode has a new grounded intent, `stocktake_help`.
- **Full report:** «اعملي تقرير كامل عن المحل» builds a report from the read-only tools. The
  private mode has a new grounded intent, `shop_report`. Any answer can be shared or downloaded.
- **From the stocktake screen:** it puts a question in the assistant's draft. The owner sends it
  himself, so the 5 messages a day are never spent without his tap.
- **Never:** the AI has no tool that changes stock, money, sales, expenses or debts, and the
  prompt forbids claiming it did.

## Consequences

- **Removed from the product UI:**
  - the package choice (sign-up, settings);
  - the sidebar and the bottom-bar component;
  - the stand-alone machines page;
  - the old services rule editor.
- **Kept:** no table, no business logic and no data was removed.
- **Pending migrations:** `20261123000000` and `20261124000000` must be applied with
  `prisma migrate deploy` (not applied to Neon dev or production by this change). Until then, a
  database without them answers 500 on the money, drawer and report routes; the log says
  «Database schema is behind the code».
