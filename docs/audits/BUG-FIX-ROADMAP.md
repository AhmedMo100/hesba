# Bug-Fix Roadmap

- **Audience:** owner and developers.
- **Date:** 2026-11-08.
- **Scope:** nothing here is implemented. Each phase is one logical fix or a tightly related group, delivered as its own change after approval.
- **Order:** money and data first, then misleading UI, security, and operations.
- **Prerequisite for every phase:** run lint, typecheck, unit, integration and e2e. Every phase adds tests before changing code, and turns the related `it.fails` tests into normal tests.

---

## Phase 0 — Decisions (owner, no code)

1. **Overselling:** reject, or allow and flag negative stock? (K5; the docs say allow-and-flag, the code clamps to 0.) Phase 1 depends on this.
2. **Approve ADR-0017,** or request changes.
3. **Offline scope for launch:** a real outbox/sync, or an explicit "online required" mode for writes? Phase 8 depends on this.
4. **AI provider env names:** which set is canonical (K9)?

---

## Phase 1 — Atomic, persisted sale (UE-01, K1, K2)

- **Root cause:**
  - The sale line sets both variant and product ids, which the DB check rejects.
  - Stock is deducted by a separate client request through `adjust`.
  - There is no idempotency.
- **Files:** `src/server/modules/sales/sales.service.ts`, `src/schemas/sale.ts`, `src/server/modules/inventory/inventory.service.ts` (`depleteStockForSale`), `src/app/api/sales/route.ts`.
- **Change:**
  - Write exactly one target on the line.
  - In one `withTenant` transaction: create the sale and line, call FEFO depletion (`type: "sale"` movements linked to the line), and update the stock level.
  - Accept a client `opId` (UUID); return the existing sale when that `opId` was already recorded.
  - Apply the Phase 0 overselling decision.
- **Tests:**
  - Convert the 4 `it.fails`.
  - Add: duplicate `opId` creates one sale; the movements sum to the sold quantity; tenant isolation.
- **Regression risks:** existing variant-less sales, and how the promotion sale flow (bundles) uses this endpoint.
- **Acceptance:**
  - Each sale yields exactly one `sales` row, its `sale_lines`, and its `stock_movements`.
  - Stock changes only through this transaction.

## Phase 2 — Sales screen honesty (UE-01/02/05, client side)

**Depends on:** Phase 1.

- **Root cause:** optimistic UI; two independent fire-and-forget requests; `localStorage` as the record.
- **Files:** `src/client/features/sales/SalesView.tsx`, `src/client/features/home/HomeView.tsx`.
- **Change:**
  - Remove the client stock-deduction request.
  - Send one sale request with an `opId`.
  - Show success only after the server accepts, or show the sale as "pending" with a retry (online-only mode until Phase 8).
  - Load the list from the server; keep local data only as clearly marked pending items.
  - Match local stock updates by variant (UE-14).
- **Tests:** unit tests for the view state; e2e "sale fails → the user sees it" and "sale succeeds → Home shows it".
- **Acceptance:** no success toast without a server acknowledgement; Home and the sales screen agree.

## Phase 3 — Sale void instead of delete (UE-03, K3)

**Depends on:** Phase 1.

- **Change:**
  - Add a `voidSale` operation that writes reversing movements to the same batches (using the recorded takes) and marks the sale voided, in one transaction and idempotent.
  - The undo UI calls it and stops sending a separate stock restore.
- **Tests:** void restores exactly the deducted quantity per batch; a double void is a no-op; another store cannot void.
- **Acceptance:** totals exclude voided sales; the stock ledger nets to zero for a voided sale.

## Phase 4 — Profile save (UE-04, K4) and signup atomicity (UE-12)

- **Files:** `src/app/api/auth/profile/route.ts`, possibly moved into `modules/tenancy`; `src/server/modules/auth/signup.service.ts`.
- **Change:**
  - Update the store inside `withTenant`.
  - Normalize the phone with `normalizePhone` before saving.
  - Map unique violations to 409.
  - Make signup's user and store creation recoverable: one transaction, or a retry path for an orphaned user.
- **Tests:**
  - Convert the profile `it.fails`.
  - Add "save profile with `01…` phone → login still works".
  - Add a duplicate phone/email test.
- **Acceptance:** owners can edit their profile and still log in.

## Phase 5 — Machine balances (UE-06)

- **Files:** `src/client/shared/api/machines.ts`, `src/server/modules/machines/machines.service.ts`, `src/app/api/machines/**`.
- **Change:**
  - Remove the silent local fallback; surface errors.
  - Server side: atomic balance update (lock or conditional update) and an `opId` for top-up, deduct and set.
- **Tests:** concurrency test with two deductions; idempotent retry; the UI shows an error on 400/401/500.

## Phase 6 — Inventory concurrency (UE-07) and settings race (K10)

- **Change:** row locks or atomic increments in inventory methods; `SELECT … FOR UPDATE` in `updateStoreSettings`.
- **Tests:** parallel operations on one variant produce the exact final balance.

## Phase 7 — Observability and honest errors

- **Change:**
  - Call `Sentry.captureException` in `toSafeErrorResponse` for the 500 and 503 paths.
  - Add request ids.
  - Map P2002 → 409 and P2025 → 404.
  - Replace the misleading 503 text.
  - Fix `PeopleView`, `AiView` and the auth client's swallowed errors (UE-11 retry `opId`).
  - Move to `instrumentation-client.ts`.

## Phase 8 — Offline / sync (UE-09, UE-15)

**Depends on:** the Phase 0 decision and its own ADR.

- **Change (either):**
  - Implement the outbox and sync engine (schema change: `sync_ops`/`change_log`), or
  - Ship an explicit online-only write mode with a correct sync bar.
- **Also:** call `syncCatalog` (or remove the offline catalog search); fix the SyncBar state.

## Phase 9 — Security hardening

- **Timing leak (UE-10):** use a real dummy hash with the same parameters.
- **Redaction:** add `email` and `clientIp` to the logger redaction list.
- **Least-privilege role:** create a role for cron/community work instead of using `HESBA_DIRECT_URL` at runtime.
- **Rate limiting:** a shared store (a Postgres table) and limits on signup.
- **Membership:** re-check membership per request (or on rotation).
- **AI search:** filter or allow-list the outgoing search query.

## Phase 10 — Configuration and operations

- **Config:**
  - Fail fast when `HESBA_DATABASE_URL` is missing in production.
  - Align the AI env names (K9).
  - Add `HESBA_CARD_KEY` to `.env.example`.
- **Pipelines:**
  - Migrate step in deploy.
  - e2e job in CI.
- **Backups:** automated backups plus a rehearsed restore runbook.

## Phase 11 — Remaining P2/P3 items

| Item | Change |
|---|---|
| Overpayment display (UE-11) | Show credit balances |
| K7 | Skip offers whose price ≥ original |
| K8 | Cairo day for expiry |
| Weighed "low stock" threshold | Make it per-unit |
| Duplicate Alerts label (UE-16) | Distinct labels; fixes the desktop e2e failure |
| Sliding sessions (UE-17) | Implement |
| Login rate-limit status (UE-18) | Return 429 |
| K6 | Accept any RFC 4122 version |
| `AdjustStockModal.tsx` | Removal decision |

---

## Not bugs: missing features (plan separately)

- Credit sale with customer selection
- Multi-item cart and invoices
- Discounts and payment methods
- Returns and refunds
- Prepaid card stock (`CardSerial`)
- E-wallets
- Commissions in the services flow
- Barcode/QR and product images
- Web app manifest / installability
- Subscriptions and billing
- Admin
- Jobs/flags tables
