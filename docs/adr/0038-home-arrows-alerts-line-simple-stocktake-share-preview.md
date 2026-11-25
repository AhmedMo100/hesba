# ADR-0038: Home with three arrows and the alerts line, a simpler stocktake, the share preview, the caching rules

- **Status:** Accepted
- **Date:** 2026-11-26
- **Decision-maker:** Ahmed Tarek / Team Hesba (owner's decisions of 2026-11-26)
- **Amends:** ADR-0037 (Home: the bell and the step arrows; «بيعت حاجة» in gold), ADR-0036 (the
  stocktake screens)

## Context

The owner reviewed PR #51 and asked for four changes, and for the platform to be ready for
production:

- **Home.** Fewer arrows, in three places only. «بيعت حاجة» stops looking like «الجرد». Only «شوف
  تقاريرك» stands out a little, the way «اسأل حسبة» does. No bell beside «أهلاً بيك»: alerts go back
  to the plain line under «فلوس المحل».
- **«اعمل جرد».** Much simpler and smaller, with very short guidance. The counting logic must not
  change.
- **A shared link** must show Hesba's logo, name and one plain sentence on WhatsApp, Facebook,
  Messenger, Telegram, X and the like.
- **Performance.** Measure it. Cache only what is safe to be stale. Money, stock, sales, debts,
  services and the stocktake must never show an old value after a write.

## Decision

### Home

The four steps sit two by two (RTL: ١ ٢ on top, ٣ ٤ below). There are **three small arrows** (16px
chevrons, muted), each in a gap and never on a card:

| From | To | Where |
| --- | --- | --- |
| ١ دخلت بضاعة | ٣ بيعت حاجة | ↓ under ١ |
| ٢ صرفت فلوس | ٤ شوف تقاريرك | ↓ under ٢ |
| ٣ بيعت حاجة | ٤ شوف تقاريرك | ← between them |

- Nothing sits between ١ and ٢. The elbow from ٢ to ٣ is removed.
- The grid uses named areas (`"s1 . s2" "d1 . d2" "s3 h3 s4"`). It follows the page direction, so
  it works the same on a phone and a desktop.
- «بيعت حاجة» is a normal step, like ١ and ٢. «شوف تقاريرك» uses the soft sage of «اسأل حسبة»: a
  light background and a thin border. The gold stays on «الجرد» only.
- The bell is removed. The alerts line from before ADR-0037 comes back, right under «فلوس المحل». It
  shows the same text («⚠️ 2 خلصوا · 1 قرب يخلص» or «🔔 مفيش تنبيهات دلوقتي») and opens the same
  «التنبيهات» screen.

### «اعمل جرد»: the interface only

- **First screen:** three short steps (١ عدّ اللي موجود قدامك · ٢ قارن الكمية باللي عند حِسبة · ٣
  راجع الفرق وأكّد الجرد), then «اعمل جرد جديد», then any count that isn't finished, then past
  counts.
- **Counting one product:** the product's name, then «الموجود في حِسبة: 20», then «إنت عدّيت: [ ]»,
  then «التالي».
  - A shortage shows «فيه فرق: −3» and «السبب؟» with four buttons: اتباع ومتسجلش · تالف · مفقود ·
    سبب آخر.
  - A surplus shows «فيه زيادة: +2» and «جت منين؟».
- **Summary:** only the reasons that were used, and one line per money effect.
- **Sizes are smaller:** titles 19px, the count input 22px (was 28px), cards with 12px padding, a
  5px progress bar. Touch targets stay at least 44px.
- **Nothing in the logic changed:**
  - The same API calls and the same validation.
  - The same rules for «اتباع ومتسجلش» in each package; the effect is still shown before confirming.
  - The same confirmation step.
- **«منتهي الصلاحية»** is no longer one of the four buttons. It is still a valid reason on the
  server and in older counts. A line that already has it shows it as a fifth button, so nothing is
  lost when a count is resumed. Damaged goods by expiry are recorded from «التنبيهات» ← «التالف»
  (ADR-0037).

### The share preview

- `src/app/site-metadata.ts` is the one source:
  - title «حِسبة — إدارة محلك ببساطة»;
  - description «اعرف فلوسك وبضاعتك وديونك ومكسبك من مكان واحد.»;
  - Open Graph (`ar_EG`, `website`), an X `summary_large_image` card, icons, and `metadataBase`.
- **`metadataBase`** comes from the deployment's own origin (`HESBA_APP_ORIGIN`, else Vercel's URL),
  never from a request. Crawlers get absolute image URLs.
- **`public/og-image.png`** (1200×630, about 75 KB) is drawn by `scripts/make-og-image.mjs`:
  - from Hesba's logo, colours and Tajawal font;
  - in a real browser, so the Arabic is shaped correctly (Satori, behind `next/og`, does not join
    Arabic letters).
- **The manifest** uses the same name and description.
- **No shop or user data** is ever in the metadata. The pages crawlers read (`/`, `/login`,
  `/signup`) are public.

### Caching: what is cached, and what never is

**Never cached on the server.**
- Every API route is `force-dynamic`, and there is no `unstable_cache`, `"use cache"` or fetch
  cache.
- The service worker sends `/api/*` to the network only (`NetworkOnly`). Its cache is static assets
  only.

**The browser's read cache** (`client/shared/api/read-cache.ts`):
- An answer is reused for at most 30 s; the product list for 120 s.
- Any successful write from the tab drops the whole memory cache, and other tabs are told
  (BroadcastChannel). An answer that was in flight during a write is not kept.
- So after a sale, a stock entry, a waste record, a payment or a stocktake, the next read goes to
  the server.
- The screens «فلوس حِسبة», «الخدمات», «الجرد» and «بيعت حاجة» (إدارة المحل), and the waste
  log, read with `fetch` directly, so they are never served from memory.

**Offline copies** (IndexedDB) are kept per shop, labelled as offline copies, and only read when
there is no network. Financial writes still need the server's confirmation; the offline outbox
covers sales only, as before.

**Safe to cache (already so):**
- the static build files and the preview image (immutable, served by Next and the service worker);
- `GET /api/sync/catalog` (`private, max-age=60`, the shared product catalog).

**One hardening, nothing new cached.** Every API answer except the catalog sync now carries
`Cache-Control: private, no-store` (`next.config.ts`). Before, they carried no header at all, so
browsers and proxies had no explicit instruction. The measurements (below) showed no read that
would gain from a server cache without risking a stale balance.

### Performance: measured, one real fix

**How it was measured.**
- A production build (`next build`, `node server.js`) against Neon dev.
- Each statement's duration came from Prisma's query events.
- Every endpoint was called 3–5 times, in both packages, on a shop with products, stock, sales,
  debts, an expense and a waste record.

**What the numbers show.**
- Each database round trip costs about 65–80 ms from Egypt to Neon in Frankfurt. An endpoint's
  latency is almost exactly its statement count times that.
- No single query was slow: the outliers were network spikes on `SELECT 1` and `set_config`.
- Every request starts with 6 statements for the session check.

**The fix: «فلوس المحل» / «فلوس حِسبة» (`GET /api/money`).**
- It used to build the whole drawer screen to read one number: each movement since the last
  count, the unrecorded ones, and the last five counts. That was **44 statements, 3.5–6.2 s**.
- `drawerExpectedInTx` now computes only the expected cash, from the same flows and the same
  formula. It is now **25 statements, about 2.0 s** from here.
- An integration test pins the amount to the piaster against the drawer screen.
- The round-trip budget test (`query-budget.spec.ts`) now includes `money` at 25. The old code
  measures 42 there and fails it.
- The assistant's money tool uses the same function.

**Left as they are, with the reason.**
- **`GET /api/drawer`** (41 statements): its screen shows every list it reads.
- **`GET /api/products?filter=all`** (227 KB): it is the shared catalog. It is sent gzip (28.6 KB
  on the wire), the read cache keeps it for 120 s, and it is the offline copy.

**Screens.**
- Opening any of the 11 screens from Home sends 1–5 API requests, and none twice.
- A second visit with no write in between is served from the read cache (0–3 requests).

**In production,** with the app and the database in the same region (a round trip of about
1–2 ms), the same statement counts mean tens of milliseconds. **Keep the deployment region next
to the database's.**

## Consequences

- **Positive:**
  - Home reads in one glance.
  - The alerts are where the owner expects them.
  - The stocktake fits a phone without scrolling past the reasons.
  - Shared links look like a product.
  - The caching rules are written down: nothing financial can show an old value after a write.
- **Risks:**
  - The preview image is a static file. It must be regenerated (`node scripts/make-og-image.mjs`)
    when the logo or the sentence changes.
  - Messaging apps cache a link's preview on their side for days.
- **When to revisit:**
  - when Hesba gets a public landing page with its own wording;
  - if a screen's measured latency grows beyond the session check plus one transaction.
