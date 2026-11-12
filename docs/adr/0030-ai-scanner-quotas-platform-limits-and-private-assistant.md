# ADR-0030: AI product scanner, per-shop credits, platform AI limits, private assistant, credit invoices

- **Status:** Proposed (provider choice and live keys await the owner's approval; see "Provider")
- **Date:** 2026-11-12
- **Related:** ADR-0020 (sales outbox), ADR-0023 (people ledger), ADR-0024 (roles), ADR-0026 (AI 503s), ADR-0027 (invoices, returns), ADR-0028 (offline classes)

## Context

Prompt 2 asked for:

- complete sales and credit sales;
- a visual AI product scanner (photos, not barcodes) that feeds the existing Sales cart;
- per-shop scanner credits set by an administrator;
- platform-wide AI limits and spending protection;
- an improved Ask Hesba assistant;
- free AI tiers where it is safe.

**What existed:**

- **Sales:** invoices, credit sales and returns (ADR-0027).
- **Assistant:** Gemini, read-only tools, 5 messages per day, 7-day retention.
- **Missing:** platform admin, AI usage tracking, a scanner, and any limit beyond the assistant's daily count.

**Problems found:**

1. **Credit payments.**
   - A «ليك» payment that wasn't tied to an invoice lowered the customer balance but never the invoice's remaining amount, so the two disagreed.
   - After such a payment, collecting the invoice could leave a hidden credit.
2. **Shop data on the free tier.** The assistant sent shop data (sales, debts, customer names) to Gemini whenever a key was set. Google's unpaid-service terms say content is used "to provide, improve, and develop" products, that "human reviewers may read, annotate, and process" it, and: "Do not submit sensitive, confidential, or personal information to the Unpaid Services".
3. **Mislabelled sales.** The assistant's sales tool counted e-wallet and card sales as credit, and "month" meant the last 30 days.

## Decision

### 1. Credit invoices agree with the balance (no migration)

- **General payments are allocated at read time.** A «ليك» payment not tied to an invoice settles the oldest open debts first, by date, invoices and other debts alike (`allocateLedgerToInvoices`, `src/domain/ledger.ts`).
- **What uses this allocation:**
  - an invoice's remaining amount;
  - the cap on paying an invoice;
  - how much of a return is refunded rather than credited.
- **The invariant:** the invoices' remaining amounts, plus other debt, minus the customer's credit, always equal the balance.
- **`GET /api/people/:id/invoices`** returns, for each credit invoice:
  - a short number, the date and the products in their units;
  - the total, what was paid on it, what general payments covered, and what is left;
  - its status and payment history;
  - plus the general payments.
- **The screen:** «الفواتير والمدفوعات» on each «ليك» customer card. Part or all of one invoice can be collected there.
- **Overpayment** of a single invoice is refused. A general overpayment still becomes the customer's visible credit, as ADR-0023 already allowed.
- **Credit sales stay online-only.** An offline credit sale would need a customer record, a receivable and a balance check that can conflict across devices. Financial correctness wins.

### 2. Scanner: photos → what the model saw → the shop's real products

- **Uploads.**
  - Up to N photos (admin-set, at most 10).
  - Resized to 1280 px and re-encoded as JPEG on the device, which drops EXIF metadata such as location.
  - Posted as base64 JSON, so the same-origin, JSON-only write guard still applies.
  - The server checks each file's real type from its first bytes and its size.
  - **Photos are never stored.**
- **The model** (`VisionProvider`) receives only the photos and a fixed instruction: no shop name, catalog, prices or stock. Its JSON answer is validated with zod as untrusted input. Unknown fields such as prices or ids are dropped, and out-of-range values fail.
- **Matching is deterministic** (`src/domain/scan-matcher.ts`).
  - A known brand, size or flavor that conflicts with a product excludes it.
  - **Matched** means a strong score, model confidence of at least 0.6, and a clear lead over the runner-up.
  - Anything weaker is **uncertain** (the user must choose) or **unmatched** (manual search).
  - The same product seen several times becomes one line with the quantities summed, flagged "seen in photos 1 and 2".
- **What comes from the database:** ids, prices, stock and units only.
- **Confirmed lines join the existing cart,** in normal or credit mode. Checkout checks everything again. The scanner creates no product, invoice or stock movement.

### 3. Scanner credits per shop (independent of the provider)

- **One submitted batch counts as one scan.**
- **Limits:**
  - daily and monthly, on the Cairo calendar (day and month);
  - the shop's override if set, otherwise the platform default;
  - plus bonus credits granted by the admin, used once a limit is reached.
- **Reservation.** A scan is reserved (`ai_scan_operations.status = reserved`) under a row lock on the shop's quota row, so parallel scans can't exceed the limit. One scan per shop runs at a time.
- **A scan counts only when it ends `succeeded`** with a valid answer.
  - Refusals, provider errors, timeouts, rate limits and invalid output are marked `failed` and never count.
  - A reservation older than two minutes no longer counts.
- **Retries.** The same `opId` returns the first result. A retry after a failure tries again.
- **Changing the key, model or provider** does not touch shop quotas or usage. They live in the database.

### 4. Platform limits (shared by all shops and server instances, in Postgres)

| Order | Check | Behaviour |
|---|---|---|
| 1 | Feature switch | Set by the admin |
| 2 | Circuit breaker (`ai_provider_health`) | Opens after N consecutive provider failures, or **at once** for a bad key, billing, a missing model or an exhausted provider quota (no retry storm). After the cooldown, the next request tries again (automatic recovery). |
| 3 | Requests per minute per feature (`ai_capacity_minutes`) | One atomic upsert |
| 4 | Concurrent calls (`ai_inflight`) | Leases that expire on their own |
| 5 | Monthly budget (`ai_budget_months`, micro-USD) | The estimate is reserved before the call and reconciled after, under a lock |

- **Fair usage:** requests per minute per shop, and one scan per shop at a time.
- **A refusal happens before any provider call,** so no shop is charged for it. Users see the generic message: «تم إيقاف خدمة الذكاء الاصطناعي مؤقتًا…».
- **What never happens automatically:** raising a limit, switching provider, falling back to a paid model, or spending more.
- **Usage events** (`ai_usage_events`) record shop, feature, provider, model, status, error category, tokens, images, estimated cost and latency. They hold **no question, answer or image**.
- **Provider errors are classified** (`ProviderError`):
  - per-minute 429 → `rate_limited`;
  - per-day 429 → `provider_quota`;
  - `billing`, `invalid_key`, `model_unavailable`, `unavailable` (5xx), `timeout`, `invalid_request`, `invalid_output`.
  - `Retry-After` is respected.
  - Only brief failures are retried, once, inside the request.

### 5. Assistant privacy

- **Shop data reaches an external model only** when the operator sets `HESBA_AI_ASSISTANT_DATA_SHARING=approved`. That is a statement that the provider tier's terms are acceptable, for example Gemini Paid ("Used to improve our products: No").
- **Otherwise the assistant runs in private mode,** and also whenever no key is set.
  - The server recognises the common Egyptian-Arabic questions (`grounded-answers.ts`), runs the same read-only tools in the shop's tenant context, and writes the answer from their results.
  - Nothing leaves the server.
  - An unsupported question gets an honest message and no credit is used.
- **Assistant fixes:**
  - **Message ids:** a message id is stored under a lock, so parallel sends store it once. Its reply is the message right after it; previously, a retried question could replay another question's answer.
  - **Pricing and limits:** model rounds go through the platform gate and are recorded.
  - **Tools:**
    - periods are on the Cairo calendar (`today`, `yesterday`, `week`, `last_week`, `this_month`, `month`);
    - only «آجل» counts as credit;
    - quantities carry their unit;
    - cart lines are named through the variant.
- **The screen:**
  - suggestions are only questions the tools can answer;
  - the input is an auto-growing textarea;
  - a retry keeps the message id;
  - offline keeps the draft;
  - a private-mode note is shown.

### 6. Platform admin

- **Who is an admin:** a user listed in `platform_admins`, written by staff only, via SQL as the migrator.
- **The admin flag:** `withPlatformAdmin` sets `app.platform_admin = 'on'`. The RLS function `hesba_is_platform_admin()` accepts it **only** for a listed `app.user_id`.
- **What it opens:**
  - read access to the AI tables and to `stores`;
  - write access to the scanner quota rows;
  - write access to the settings row;
  - inserts into the audit log.
- **What it never opens:** sales, stock, money or people.
- **Audit:** every change is recorded in `ai_admin_audit` with the admin, old and new values, the reason and the time.
- **The page:** `/admin` shows usage, provider status, budget, a 30-day trend, top shops, global settings, per-shop quotas and bonus grants, and the audit log. It refuses non-admins, and every admin API also returns 403 to them.

## Provider (evaluation, 2026-11-12; nothing live without the owner's approval)

| | Scanner (photos only) | Assistant (shop data) |
|---|---|---|
| Recommended | Gemini API, `gemini-3.5-flash-lite` (vision, structured output; "Free of charge" tier listed; paid $0.30 / 1M input, $2.50 / 1M output) | Gemini API **Paid tier**, `gemini-3.6-flash` (function calling; $0.75 / $3.75 per 1M through 2026-12-31, then $1.50 / $7.50) |
| Free tier OK? | Yes, with disclosure: photos of products carry no financial or customer data. The unpaid terms still allow training and human review, so a photo showing a person or a document is a risk the shop should know about. | **No.** The unpaid terms forbid sensitive, confidential or personal information. Without a paid tier the assistant stays in private mode. |
| Free-tier limits | Shown only in AI Studio for these models (the docs page lists none); not verified | — |
| Others checked | Groq: no retention by default; ZDR available to all; training not stated on its data page, so not verified. Cloudflare Workers AI: 10,000 neurons/day free; data-use terms not on its pricing page, so not verified. | |

- `gemini-3.5-flash` (the previous default) is **deprecated**: requests are routed to `gemini-3.6-flash`.
- **Sources:**
  - [Gemini API terms](https://aistudio.google.com/docs/terms)
  - [Gemini pricing](https://aistudio.google.com/docs/pricing)
  - [Gemini models](https://aistudio.google.com/docs/models)
  - [Gemini deprecations](https://aistudio.google.com/docs/deprecations)
  - [Gemini available regions](https://aistudio.google.com/docs/available-regions) (Egypt is listed)
  - [Groq: your data](https://console.groq.com/docs/your-data)
  - [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## Consequences

- **Migration** `20261119000000_ai_scanner_quotas_and_usage` is additive: new tables, policies, one function and grants.
  - It is **not applied to Neon dev or production.** Run `pnpm db:migrate` with the target `HESBA_DIRECT_URL` when approved.
  - To list an admin: `INSERT INTO platform_admins (user_id) SELECT id FROM users WHERE email = '…';` as the migrator.
- **The default limits are assumptions** (D36), editable in `/admin` without a deployment:
  - 10 scans per day and 200 per month per shop;
  - 6 photos per scan;
  - 10 requests per minute per feature, 4 concurrent;
  - 3 requests per minute per shop;
  - a budget of $0 (free tier, estimates 0).
- **The ai-cleanup cron** also clears stored scan results (descriptions only) after 7 days, and removes old counters and expired leases.
- **No Redis.** Postgres holds the counters; revisit if AI traffic outgrows one database.
