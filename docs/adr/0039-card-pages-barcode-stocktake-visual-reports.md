# ADR-0039: Card pages, a barcode stocktake, and visual stocktake results

- **Status:** Accepted
- **Date:** 2026-11-26
- **Decision-maker:** Ahmed Tarek / Team Hesba (owner's decisions of 2026-11-26)
- **Amends:** ADR-0036 («فلوس حِسبة», the stocktake screens), ADR-0038 (the stocktake's words),
  ADR-0031 (the drawer count)

## Context

The owner asked for:

- one card look across the main pages, each page with its own colour;
- «فلوس حِسبة» without «عدّ الدرج» or «حط رصيد», with its actions under the title;
- owner withdrawals and transfers shown for what they are;
- a stocktake that is fast with a barcode but never needs one;
- a simple, visual result, which «اسأل حسبة» can show too.

The accounting rules must not change.

## Decision

### One card system: Home's cards

`src/client/shared/styles/Cards.module.css` is Home's card, shared. Every value is Home's own (`.numCard`, `.tile`, `.step*`, `.stocktakeWide`, `.tileAsk`, `.mini*`), and Home itself is unchanged:

- **The card:** background `var(--card)`, no border, radius 18px, padding 14px, Home's shadow (`0 2px 8px rgba(0,0,0,.05)`), and the same 0.97 press.
- **Type:** label 15px/700 muted, value 24px/900, one 13px line.
- **Buttons:** Home's `.mini` / `.miniDark`.
- **Colours:** only Hesba tokens and colours Home already uses.
  - Each page has an identity, taken from Home's accents. It colours the page's lead card only.
  - Status keeps the app's stock colours: low `--yelBg` ring `--yelLine`, out `--redBg` ring `--red`, good a green value (Home's `.numGood`).
  - Debt direction is the amount's colour: ليك green, عليك red.
- **Titles:** every page keeps its original title, and the stocktake keeps its original titles and three steps. A unit test pins them.

| Page | Identity (from Home) | The page's cards |
| --- | --- | --- |
| «بيع حاجة» | gold (`.stocktakeWide`) | Tiles with Home's radius and shadow. Status: قرب يخلص (yellow), صلاحيته قربت (beige, dashed gold edge, new), خلص (red). |
| «محلك ماشي إزاي؟» | «شوف تقاريرك» sage | One question per card (المبيعات is the lead), then بعت إزاي; the lists are folded under «التفاصيل». A computer shows them four across. |
| «إيه اللي محتاج تاخد بالك منه؟» | warning yellow | Three kind cards that are also the tabs; each alert is a card with a chip, one line and its one action. |
| «إيه اللي عندك في المحل؟» | sage | Name, الكمية · السعر, one status chip. A tap opens the existing sheet with every action. |
| «بتقدّم خدمات إيه وعمولتك كام؟» | beige | Name, category, العمولة; one «⋯» menu (تعديل · حذف). |
| «مين ليك ومين عليك؟» | cream | Name and «ليك: X» (green), «عليك: X» (red) or «خالصين ✓». |
| «فلوسي فين؟» | step green (`.stepGreen`) | كل فلوسك (lead) · فلوس الدرج · each machine and wallet. Its three actions sit in one row under the title. |
| «الجرد» | gold | Sections, the counted product, the result cards and the charts. |

### «فلوس حِسبة»

- **The three actions sit in one row under the title**, each Home's tile in small (icon over its label), one height: «➕ ماكينة / محفظة» (the main one, Home's dark button) · «🔁 تحويل» · «💸 سحبت لنفسي». Each is as wide as its label plus an equal share, so nothing clips at 360px.
- **«عدّ الدرج» and «حط رصيد» are gone from the page** (the drawer screen still exists, but nothing links to it).
- **«فلوس الدرج» is never typed in.** It is the shop's cash operations: cash sales, collections and the day's totals in; expenses, purchases, supplier payments, transfers and withdrawals out.
  - It starts from zero when the drawer was never counted.
  - It starts from the last count for shops that counted before; their history stays as it was.
  - It can be negative, and the card says so plainly («طلع منه أكتر من اللي دخله»): more cash went out than the shop recorded coming in, for example opening stock paid from cash.
- **A machine or wallet gets money by «تحويل»** from the cash or another account: a recorded movement on both sides. It is never a typed balance.
- **The history labels each movement:** «🔁 تحويل» (never income or an expense) or «💸 سحب شخصي من الأرباح» (never an operating expense).
- **The reports keep the existing model.**
  - «سحبت لنفسك» is its own card, «من أرباحك · مش مصروف», and it is not subtracted as an expense.
  - Transfers appear in no report total.

### The barcode stocktake

1. «اعمل جرد جديد» opens «اختار قسم».
   - The sections and their product counts come from the server (`GET /api/inventory-counts` → `sections`).
   - The page never loads the shop's product list. Services and sandwiches are not sections.
2. **Counting a section** (`StocktakeCounter`) offers three ways, all to the same line:
   - **«📷 امسح الباركود»**: the camera, a physical scanner, or a typed code. The product opens under the camera, decoding pauses, «حفظ» saves it and the next scan follows.
     - A barcode of another section says which section it is in.
     - An unknown barcode says to search by name.
   - **«دوّر بالاسم»**: searches the count's lines with Arabic letters normalised, debounced to one request after typing stops.
   - **The lists «لسه» / «اتعدّ»**: 30 lines per page, «عرض أكتر».
   - So the barcode only speeds things up: weighed and loose goods are found by name or from the list.
3. **One product:** «الموجود في حِسبة: 20» · «إنت عدّيت: [ ]» · «فرق: −3» · «السبب؟».
   - **Weighed goods** are typed in kilos.
   - **A product with a pack** can be counted in cartons and pieces: cartons × pack + pieces.
4. **A repeated scan never makes a second record.** It opens the same line with «اتعدّ قبل كده: 17».
   - What is typed is added («الإجمالي: 20»), or replaced by choosing «اكتب من الأول».
   - The server stores one line per product and each save is a total (set, never added), so the same save twice changes nothing.
5. **Damage recorded before** (the last 90 days) is shown as help only, with its reasons and dates: «تالف متسجّل قبل كده: 2 (متخصم من حِسبة خلاص)». Expired stock is shown the same way.
   - The expected quantity is today's stock, so damage already recorded is never added to the difference a second time.
6. **The reasons are unchanged:** اتباع ومتسجلش · تالف · مفقود · سبب آخر.
   - **«سبب آخر» needs words.** The client asks, and the server refuses it without a note (400).
   - **«اتباع ومتسجلش» is the only reason that counts as sold.** In الكاشير الذكي it is a sale the count discovered, at the selling price with its FEFO cost and profit, shown in the reports' profit and «اتباع ومتسجلش» card. In إدارة المحل its money is already in the day's totals, so it adjusts the stock only.
   - **تالف / مفقود** go to the loss ledger at cost, never revenue.
   - **No difference becomes revenue by itself.**
7. **«نتيجة الجرد»:**
   - four cards (صنف اتعدّ · فيه فرق · ناقص · زيادة);
   - «النقص» and «الزيادة» (name and −3 / +2);
   - «التأثير»: unrecorded sales and damage losses, shown only when the server computed them; a cost that is not known is said so and left out;
   - three charts.
   - Confirming and cancelling work as before: atomic, once per `opId`, owner only.
8. **API:**
   - `GET /api/inventory-counts/:id/lines`: by `barcode`, `q`, `variantId`, `status` (pending, counted or diff), `cursor` and `limit` ≤ 50.
   - `PATCH /api/inventory-counts/:id?view=brief` answers with the changed lines and the progress only.
   - Both are Zod-validated, need a session, run in the tenant transaction, and return 404 for another shop's count.

### The charts

- **What they are:** three small charts in plain HTML bars, with no chart library.
  - «حالة الأصناف»: مظبوط · زيادة · ناقص, each part labelled with its number.
  - «المتوقع والموجود»: the biggest differences, per product, in its own unit.
  - «أسباب النقص».
- **Colours:** Hesba's own: مظبوط `--ok`, زيادة `--gold` (`--cream` in the dark theme), ناقص `--red`.
  - In that order red and green are never side by side, and every pair that is side by side passes the colour-blindness check in both themes.
  - Every part is also labelled with its number, so colour is never the only cue.
  - The lists above the charts are the table view.
- **Data:** `src/domain/stocktake-charts.ts` builds the chart data from a count's lines. The screen and «اسأل حسبة» share it.

### «اسأل حسبة» and the stocktake

- **A new read-only tool, `getStocktakeResult`:** the shop's latest confirmed count.
  - Counts, the biggest shortages and their reasons.
  - Losses at cost (known costs only), and unrecorded sales (الكاشير الذكي only).
  - The chart data.
- **The model** may call it. **Private mode** answers «وريني نتيجة الجرد» (and «حلل / رسم / فروق … الجرد») from it with no model.
- **The chart is never written by the model.**
  - It is built on the server from that tool's result.
  - It is kept with the answer inside `ai_messages.sources`, next to the web citations, so it shows again in the history.
  - The API splits it back out as `visual`.
- **Isolation:** the tool runs in the shop's tenant transaction. Another shop gets «لسه ما اتأكدش أي جرد».
- **No writes:** nothing in the assistant changes a count or the stock.

### Fixes found on the way

- A service (no stock) was shown as «خلصان» in «بيع حاجة»'s product grid and in «التنبيهات».
  - Services are now skipped in both (`buildStoreAlerts`, the sale grid).
  - They are sold from the services tab, as before.

## Consequences

- **Positive:**
  - Every page reads in seconds, in one visual language.
  - A shop with hundreds of products counts a section by scanning, without loading the catalogue.
  - The result is visible at a glance.
- **Risks:**
  - «فلوس الدرج» can show a negative amount for a shop that recorded purchases paid from cash before recording its sales.
  - A shop that counted its drawer before keeps that count as the base of its cash.
- **When to revisit:** if the owner wants a way to put opening cash in the drawer: today there is no such button, by decision.
