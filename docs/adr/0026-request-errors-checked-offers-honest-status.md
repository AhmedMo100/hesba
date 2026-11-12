# ADR-0026: Request mistakes are 4xx, offers are checked by the server, status bars tell the truth

- **Status:** Proposed
- **Date:** 2026-11-12
- **Fixes:** audit QA-17, QA-18, QA-19, QA-20, QA-28, QA-29 (`docs/QA/FULL-SYSTEM-AUDIT.md`)
- **Not fixed (decision or authorization needed):** QA-30, QA-31, QA-32

## Context
- Many request mistakes became 500 "حصل خطأ غير متوقع في السيرفر. شغلك محفوظ.": a malformed body, a malformed or unknown id, a bad date. That hid real incidents and told users their work was saved when nothing was.
- Offers were stored exactly as the client sent them, so the "discount" could cost more than the regular price, have no items, or point at products that don't exist.
- The Alerts screen fetched machines in a loop.
- The AI chat waited 72 s and then returned a 500 when the provider was busy.

## Decisions

### QA-18 / QA-19: one error mapping
- Every route reads its body with `readJsonBody`. A malformed body gets 400.
- `toSafeErrorResponse` also maps:

  | Error | Status |
  |---|---|
  | `SyntaxError` | 400 |
  | Prisma `P2023`, or `P2010` with SQL state `22P02` (malformed id, including in raw row locks) | 400 |
  | `P2025` | 404 |
  | `P2002` | 409 |

  Everything else stays a logged 500.
- Services throw `AppError.notFound` instead of a plain `Error`: expense edit, product hide, the product upsert ownership check.
- The machine body is validated by `upsertMachineSchema`.
- Expense custom dates must be real `YYYY-MM-DD` dates (400 otherwise).
- The 500 and 503 messages no longer say "شغلك محفوظ". The sync bar's 503 state keeps it, because there the sales really are saved in the outbox.

### QA-20: the server checks every offer
- **The schema requires:**
  - at least 1 item (at most 50), and exactly 1 for `single_discount`;
  - variant ids that are UUIDs;
  - an offer price above 0 and below the original.
- **`publishPromotion` then re-reads each item in the shop's tenant transaction:**
  - each item must be an active variant of this shop, with a price;
  - each item's regular price is computed as the sale computes it (`saleLineTotalPiasters`, so grams of a per-kg product are priced per kg);
  - the original total and the savings are computed by the server;
  - names come from the shop's data, not the client;
  - an offer price at or above the server's original gets 400.
- **The screens:**
  - they store the offer the server returned, not their own copy;
  - they show the server's reason for a 400.
- **The suggestion generator** (`src/domain/alerts.ts`) no longer suggests an "offer" whose minimum price is not below the regular price.
- **The client's offer `id` is kept:** offers live in the shop's own settings, so an id only identifies an offer within that shop (editing is a re-publish).

### QA-28: no event loops on Alerts
- **Machines:** on `hesba_machines_updated` the screen reads the cache instead of fetching again. This is the fix SalesView got for UE-20.
- **Alerts:** the alerts event carries `totalAlerts`, so the shell's badge does not fetch `/api/alerts` again.

### QA-29: the AI reply has a deadline
- `AbortSignal.timeout(AI_REPLY_TIMEOUT_MS)` (20 s, D34) covers every model call of one reply. Providers get it through `generateChatCompletion(…, { signal })`.
- A busy provider (429/5xx) or a timeout gets **503** with `Retry-After: 30`, and the message credit is restored, as before.
- Other provider errors (bad key, bad request) stay 500, because they are our fault.
- The screen still shows its waiting card. It now shows the server's message (it used to show "[object Object]") and gives up after 25 s.

### QA-17: the sync bar
- QA-04 already counts the real outbox and never says "synced" while a sale waits.
- `deriveSyncState` adds each queued sale's last answer: 401 shows "سجّل دخولك" (and a tap opens login), 503 shows "السيرفر بيتحدّث".

## Not done in this batch, and why
- **QA-30, supplier purchases.** This is a new flow, not a fix. It needs owner decisions:
  - does receiving stock with a supplier create a purchase and a payable automatically?
  - is that payable the batch's total cost, or what was actually invoiced?
  - can a purchase be partly paid?
  - how is a purchase voided?

  The tables exist, but building the flow without these answers would invent business rules (AGENTS rule 10).
- **QA-31, cart, credit sale, discounts, payment methods, returns.** These are V1.1 roadmap features (D30 already keeps the cart for V1.1). Each needs its own phase (AGENTS rule 1).
- **QA-32, slow dev database.**
  - **Cause:** the database region, the pooler and cold starts on Neon. Changing them is infrastructure work and needs authorization.
  - **In code:** the false 500s are gone (QA-18/19), and an unreachable database is an honest 503.
  - **Measured:** none of the timings were re-measured on Neon. The Neon tool did not connect in this session.

## Consequences
- **Positive:** the logs' 500s are real incidents again; a cashier can't sell an offer that costs more than the regular price; the Alerts screen is quiet while idle; a busy AI answers in at most 20 s.
- **Risks:**
  - offers saved before this change are not rewritten;
  - a sale of an old offer whose items are missing is still refused, as before;
  - an old offer whose price is at or above the original can still be sold until it is edited or deleted;
  - **data review needed:** check the shops' saved offers.
