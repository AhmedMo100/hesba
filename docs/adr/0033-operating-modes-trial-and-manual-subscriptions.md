# ADR-0033: Operating modes, a 3-day trial and manually activated subscriptions

- **Status:** Proposed
- **Date:** 2026-11-21
- **Decision-maker:** Ahmed Tarek / Team Hesba
- **Extends:** ADR-0008 (manual renewal), ADR-0024 (DB roles), ADR-0031 (drawer)
- **Amends:** `docs/01-product.md` §7 "Fixed rule: subscription expiry = read-only" (see Decision 4)

## Context

Hesba serves two kinds of shops: owners who want to run the shop's money and stock without
recording every sale, and owners who want a cashier with every sale recorded. Every new shop gets
a 3-day free trial; after it, Hesba activates paying shops by hand (ADR-0008: Vodafone Cash /
InstaPay, confirmed on WhatsApp). There is no payment gateway and no admin panel yet.

## Decision

### 1. Operating mode — `stores.operating_mode` ('simple' | 'pos')

- **إدارة المحل (simple):** products, stock and stocktake, purchases, expenses, people and debts,
  the drawer and wallets, reports, and the **daily sales total** (one amount per day, split by
  payment). No cashier, no sale invoices; the system never claims to know which products were
  sold — a stock difference is a stocktake difference, never a sale.
- **الكاشير الذكي (pos):** everything above except the daily total, plus the cashier (every sale with
  its products, stock taken automatically, credit sales, returns, per-product reports).
- One capability map (`src/domain/operating-mode.ts`) is read by the server
  (`requireSession(req, { capability })`) and by the navigation. Sale writes (`POST /api/sales`,
  checkout, void, returns) need `posSales`; the daily total needs `dailySalesTotals`. Reading old
  invoices and collecting on them work in both modes.
- Chosen on the sign-up screen (required by `POST /api/auth/signup`, never defaulted silently).
  The owner switches it with `PATCH /api/store/operating-mode` (owner only, strict body). A switch
  changes `operating_mode` (and `operating_mode_changed_at`) only — no data, no trial restart.

### 2. Subscription — on the shop's row

`stores.subscription_status` ('trialing' | 'active' | 'expired' | 'suspended'),
`subscription_plan`, `trial_started_at`, `trial_ends_at`, `subscription_started_at`,
`subscription_ends_at`. One row per shop, read with the session in the query that already loads
the shop (no extra query per request). This deviates from the separate `subscriptions` table
sketched in `docs/03-data.md` §8: the shop is already the tenant root and the session reads it.

- **Effective status** (`src/domain/subscription.ts`): active/trialing are allowed only while their
  end date is in the future on the **server's** clock; suspended and expired are stopped; a
  missing end date never allows (also CHECK constraints in the DB). No cron is needed.
- **Every protected request** checks it in `requireSession` (402 `SUBSCRIPTION_INACTIVE`). Only
  these opt out: `GET /api/subscription`, `GET /api/auth/session`, logout, revoke other sessions,
  and Hesba's admin routes.

### 3. Trial and Hesba-only writes (database)

- A trigger (`hesba_stores_subscription_guard`) makes a shop inserted by the app's roles start a
  72-hour trial from the **database** clock, whatever the request sent, and refuses any change of
  a subscription field by `hesba_app` / `hesba_service`. A trigger
  (`hesba_stores_subscription_audit`) logs every subscription change to
  `store_subscription_events` (with the database user who made it).
- Hesba's admin acts through SQL functions with EXECUTE revoked from everyone else:
  `hesba_find_store`, `hesba_renew_subscription` (adds months after the current end while it is
  still in the future, else from now), `hesba_set_subscription_status` (suspend / expire).
  Guide: `docs/ops/subscriptions.md`. There is no endpoint that changes a subscription.

### 4. When it ends: full stop (amends the "read-only" rule)

Owner's decision (2026-11-21): when the trial or subscription is over the shop can use only the
expiry / subscription screen, contact Hesba, re-check, and log out — no reading of shop data
either. Nothing is deleted. The previous "read-only" rule in `docs/01-product.md` is replaced.

### 5. Offline

The outbox keeps a sale the server refused with 402 as `pending` (not rejected, not counted as a
failure, not deleted) and stops syncing; the sync bar says the account needs activation. Once
active again the same `op_id` is sent and recorded once. A device clock or local data never
grants access: the client only shows what the server last said.

### 6. The daily sales total (إدارة المحل)

`daily_sales_entries` (+ `daily_sales_entry_parts`): the cash part counts in the drawer, each
machine / wallet part raises that machine's balance, atomically and once per `op_id`. It is
revenue in the reports with profit shown as unknown (no cost per item). Today's entries can be
cancelled (kept on record; the wallet gives the money back, the drawer stops counting it).

### 7. Existing shops

Owner's decision (2026-11-21): every shop that existed before this migration becomes `active`,
plan `legacy`, mode `pos` (what they used), paid until the end of 2026-11-22 Cairo time
(`2026-11-22 22:00 UTC`). They never get a trial; Hesba renews them like any paid shop.

## Consequences

- Positive: access and mode are enforced on the server for every request; the app cannot extend
  a subscription even by a bug; manual renewals are audited and cannot lose paid days.
- Risks: manual activation does not scale past a few hundred shops (ADR-0008 revisit point). The
  AI assistant's tools read the daily totals through the report's financials, but not every AI
  tool knows the mode yet.
- When to revisit: a payment gateway, an admin panel, or per-plan feature limits.
