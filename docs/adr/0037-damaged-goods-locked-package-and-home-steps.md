# ADR-0037: Damaged goods as one recorded operation, the package locked to Hesba, Home as four steps

- **Status:** Accepted
- **Date:** 2026-11-26
- **Decision-maker:** Ahmed Tarek / Team Hesba (owner's decisions of 2026-11-26)
- **Amends:** ADR-0033 (the owner switching modes), ADR-0036 (Home layout, the reports page), P4
  (waste reasons)

## Context

The owner asked for four things:

- **Damaged goods.** Record them from two places, «التنبيهات» and «بضاعتي», in any unit the product
  uses (piece, carton, jar, pack, weight), with clear reasons, a reviewable log, and no effect on
  sales.
- **The package.** A shop must not change its own package (إدارة المحل / الكاشير الذكي). Hesba's
  administration changes it.
- **Home.** A fixed order: money · four numbered steps · الجرد · four more cards · logout.
- **Reports.** No «لو صفّيت المحل» section.

Waste already existed (`POST /api/stock`, `action: "waste"`; `recordWasteInTx`, P4). It locks the
variant's stock, refuses more than the stock, takes the quantity from the batches (FEFO or a chosen
batch) at their recorded cost, and is idempotent by `opId`. It did not record who did it or from
where, its reasons were few, and nothing listed the records.

## Options

1. **A new "damaged goods" table and API.** Rejected: it would duplicate the stock logic and count
   a loss in two places.
2. **Extend the existing waste operation.** Chosen.

For the package:

1. **Hide the button only.** Rejected: a hand-made request would still work.
2. **Remove the route, and refuse the change in the database for the app role.** Chosen. An admin
   function, in the same style as the existing subscription functions, is the approved way to change
   it.

## Decision

### Damaged goods (one operation, the existing one)

**Migration `20261126000000_waste_details_and_package_lock`** (additive only):
- `waste_records` gains:
  - `created_by` (FK `users`, `SET NULL`);
  - `source` (`alerts | products | stock | stocktake | return`);
  - snapshots of `product_name` and `quantity_text`, so the log reads the same after a rename or
    an archive.
- The reason CHECK widens to `near_expiry`, `storage_damage`, `broken_leak`, `poor_storage` and
  `supplier_damage`. `expired`, `damaged`, `missing`, `damaged_return` and `other` stay.
- `hesba_app` can no longer `DELETE` or `UPDATE` waste records, except `cost_minor` (written once,
  in the same transaction). The log is history.

**Reasons offered to the owner:**
- منتهي الصلاحية
- قرب انتهاء الصلاحية
- تلف أثناء التخزين
- كسر أو تسريب
- سوء تخزين
- تالف من المورد
- سبب آخر (its description is required, on the server too)

**API:**
- `POST /api/stock` with `action: "waste"` also takes `source`.
- `GET /api/stock?view=waste` is the log, newest first. Each row has the product, the quantity in
  its unit, the reason, the note, the cost, the source, who recorded it and when.

**Unit:**
- The client converts what the owner types to base units with the shared rules
  (`quantityBaseFromInput`: kilograms → grams, packs + units → pieces).
- The server writes the quantity text from the variant's pack and unit (`wasteQuantityText`, the
  shared unit words).

**Screens:**
- «بضاعتي»: the product sheet's «🗑️ سجّل تالف».
- «التنبيهات»: a third filter «التالف», with the log and «+ سجّل منتج تالف» (it picks the product
  first).
- Both use one form, `RecordLossModal`. It refuses more than the stock before sending. Offline, it
  says the record needs the internet and was not saved. Nothing is shown as done before the server
  answers.

**Effect:**
- The stock goes down at once, so «بضاعتي», the cashier and every stock read see it.
- A loss is recorded at the batches' cost. Reports show it under «التالف» and subtract it from the
  full account, as before.
- No sale, no revenue. The same `opId` is recorded once.

### The package is Hesba's to change

- `PATCH /api/store/operating-mode`, its service and the switch sheet are removed.
- The store menu shows «الباقة: …» read-only, with «لتغيير الباقة كلّم إدارة حِسبة».
- A trigger, `hesba_stores_operating_mode_locked`, refuses any change of `stores.operating_mode` by
  `hesba_app` or `hesba_service`. Whatever request reaches the server, the database says no. Other
  store fields still save.
- Sign-up still sets the package once (an INSERT).
- Administration:

  ```sql
  SELECT * FROM hesba_set_operating_mode('<store uuid>', 'simple' | 'pos');
  ```

  `SECURITY DEFINER`, not callable by the app or service roles. It updates `operating_mode_changed_at`
  only when the mode changes.

### Home and the reports page

**Home, in order:**
1. «أهلاً بيك», with a small bell that opens «التنبيهات» and shows the count. The alerts page must
   stay reachable: damaged goods are recorded there.
2. «فلوس المحل», full width. It opens «فلوس حِسبة».
3. ١ دخلت بضاعة → ٢ صرفت فلوس → ٣ بيعت حاجة → ٤ شوف تقاريرك. The arrows sit in the gaps, and an
   elbow turns from ٢ down to ٣ (RTL).
4. «الجرد», full width.
5. البضاعة · الخدمات · اسأل حسبة (a slightly different colour) · حسابات الناس. Not numbered.
6. The only logout, full width.

There is no profit card on Home; profit lives in the reports. The store menu's logout item is
removed: Home's is the only one. The change-password and subscription screens keep theirs.

**Reports:** the «🧮 حساب المحل كله لو صفّيت دلوقتي» link is removed. The `inventory` page and
its logic stay.

**Page headings:** one shared `PageTitle` component, in the same style as «دخلت بضاعة جديدة؟»:

| Page | Heading |
| --- | --- |
| حسابات الناس | مين ليك ومين عليك؟ |
| بضاعتي | إيه اللي عندك في المحل؟ |
| الخدمات | بتقدّم خدمات إيه وعمولتك كام؟ |
| اسأل حسبة | عايز تعرف إيه عن محلك؟ |
| الجرد | عدّ بضاعتك واعرف الناقص |
| التنبيهات | إيه اللي محتاج تاخد بالك منه؟ |
| التقارير | محلك ماشي إزاي؟ |

## Consequences

- **Positive:**
  - One loss path: the cost is counted once, the history can't be deleted, and the log is
    reviewable.
  - The package can't be changed by any request.
  - Home follows the day's order.
- **Risks:**
  - Code from this ADR on needs the migration. Without it, writing a waste record fails (the new
    columns are missing). Run `prisma migrate deploy` before the new code.
  - The «حساب المحل كله» page has no link left on any screen.
- **When to revisit:** if shops ask for editing or undoing a damaged-goods record. That would be a
  reversal movement, never a delete.
