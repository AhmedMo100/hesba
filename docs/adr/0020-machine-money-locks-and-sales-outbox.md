# ADR-0020: Locked, idempotent machine money and a durable sales outbox

- **Status:** Proposed
- **Date:** 2026-11-10
- **Decision-maker:** Project owner (approval pending)
- **Fixes:** audit QA-03 and QA-04 (`docs/QA/FULL-SYSTEM-AUDIT.md`); earlier UE-06 (server part) and UE-09 (sales part)
- **Builds on:** ADR-0019 (atomic server-side sale, stock row locks)

## Context

### QA-03: POS-machine money lost updates

`MachinesService` handled top-up, adjust and deduct the same way:

1. read `pos_machines.current_balance_piasters`;
2. computed the new balance in JavaScript;
3. wrote it back.

There was no lock and no idempotency key. The ledger row (`pos_machine_topups`) and the balance were written in one transaction, but from a stale read.

- **Effect:** 5 parallel deductions of 30.00 from 100.00 all succeeded and left 70.00. The ledger shows five rows, each with `balance_after = 70.00`.
- **Service sales:** charging the machine was a separate client request before the sale request, and a rejected sale was "refunded" with yet another request.
- **Client fallback:** the client fell back to changing the balance in `localStorage` whenever the server failed.

### QA-04: offline sales lost

An offline sale showed "تم تسجيل بيع" and never reached the server.

- Dexie had an `outbox` table that nothing used.
- The sync bar showed "0 pending".
- `docs/03-data.md` Part 2 describes the intended model: outbox states, rejection review, event-driven triggers, and full-jitter backoff without `setInterval`.

## Decision

### Machine money (server)

- **One function for every balance change.** `changeMachineBalanceInTx`:
  1. locks the machine row (`SELECT … FOR UPDATE`);
  2. returns the earlier result when the `opId` was already applied (checked **after** the lock);
  3. rejects a resulting balance below zero (400);
  4. writes the ledger row and the new balance, both computed from the locked balance.

  Top-up, adjust, deduct and the service sale all use it.
- **Why a row lock:** a conditional `UPDATE … WHERE balance >= x` would fix the balance, but not the ledger's `balance_after`, which must reflect the same serialized order. Serializable isolation would need retry loops everywhere.
- **Migration `20261110000000_pos_machine_money_safety` (additive):**
  - `pos_machine_topups.op_id uuid NULL`, with a unique `(store_id, op_id)`;
  - `CHECK (current_balance_piasters >= 0) NOT VALID`, a database guard for the existing no-overdraft rule that does not re-check old rows.
- **Validation:** money endpoints are validated by `src/schemas/machine.ts`. They accept integer piasters only, up to 10,000,000 EGP. A decimal, a numeric string or NaN is a 400, never a 500.
- **Service sale:** a service paid through a machine is charged **inside the sale transaction** (`recordServiceSaleInTx`). The ledger row carries the sale's `opId`, and the charge can't exceed what the customer paid.
  - The sale and the charge commit or roll back together.
  - A retry or a concurrent duplicate charges once.
  - The client-side refund is gone.
- **Client money calls:**
  - `addRemoteMachineTopup`, `setRemoteMachineExactBalance` and `deductRemoteMachineBalance` send an `opId` and **throw** on failure, with no local fallback.
  - The top-up modal keeps one `opId` per intended operation (same machine, mode and amount), so a retry can't double-charge.
  - Creating or deleting a machine still falls back to the local copy: not money, out of scope.

### Sales outbox (client)

- **Store:** the existing Dexie `outbox` table (version 4 adds a `store_id` index) with its existing states: `pending → sending → (deleted: applied/duplicate) | rejected | quarantined`.
- **Every sale is enqueued first,** durably, with a new `opId`, then sent to the **same** `POST /api/sales` transaction (ADR-0019). There is no separate "offline" server path: pricing, stock locks and checks, tenant isolation and idempotency are identical.
- **Classification of an attempt:**

  | Answer | Result |
  |---|---|
  | 200 | Delete the op (applied). The UI lists the sale with the server's total. |
  | No answer / timeout (30 s), 408, 429, 5xx | Back to `pending` with full-jitter backoff (`min(30 s, 1 s × 2^n)` + up to 1 s). After 8 attempts: `quarantined` (kept, shown). |
  | 401, or 403 `STORE_MISMATCH` | `pending`, not counted as an attempt (waits for the right login). |
  | Any other 4xx (e.g. 409 not enough stock) | `rejected`: never resent automatically, shown in "محتاج مراجعة", with "جرّب تاني" (same `opId`) and "إلغاء البيعة". |

- **Immediate send:** right after a tap, the sale is sent at once.
  - A rejection then (the cashier is watching) is shown as an error and removed from the queue.
  - Offline, or with no answer, it stays queued and is shown as waiting.
- **Exclusive sender:** only one sender runs at a time across tabs, using the Web Lock `hesba-sale-outbox`. Inside the lock, a `sending` op can only be a leftover from a closed tab, so it is sent again with the same `opId`.
- **Triggers (no polling):**
  - startup or sign-in;
  - `online`;
  - the tab becoming visible;
  - a new sale;
  - "زامن دلوقتي" or a tap on the sync bar;
  - one backoff timer after a transient failure.
- **Tenant:**
  - an op stores its `store_id` and is only listed and sent while that shop is signed in in this tab (`setActiveOutboxStore`);
  - each attempt sends `X-Hesba-Store-Id`; if another shop is signed in on the server, it answers 403 `STORE_MISMATCH` and the op stays pending;
  - the server always records under the session's shop. The header can only cause a refusal.
- **Honest UI:**
  - a queued sale shows an amber "اتحفظت على الجهاز ومستنية تتسجل… لسه ما اتسجلتش على السيرفر" toast, never "تم تسجيل بيع";
  - the Sales screen lists waiting and rejected sales in a separate section that isn't counted in today's sales;
  - the sync bar says "synced" only when nothing is waiting or needs review.
- **Local stock:** tile stock figures are the server's last known values. A queued sale does **not** change them; the queue section shows what is waiting. No local stock model is invented.
- **Services need the server to start:** they are charged to a POS machine, so a service sale is refused while offline. If its answer is lost, it stays queued and is retried with the same `opId` like any sale.

### Offline conflict (stock sold elsewhere before the queued sale arrives)

The documents disagree:

| Source | Says |
|---|---|
| D13 / `03-data.md` §4 | "allow and flag negative" |
| D31 (2026-11-10, ADR-0019) | Online sales above the stock are rejected; D13 kept for offline sales |
| `03-data.md` §6 `fefo_depleted` | "Server flags negative stock **or** prompts stock intake" |

The task for this change requires never creating negative stock while the online rule rejects it. So a queued sale goes through the same check and, when short, is **rejected whole (409)** and kept for review: retry it after adding stock, or cancel it. It is never applied partially and never marked synced. **This is recorded as D32 for the owner to confirm or replace.**

## Consequences

- **Positive:**
  - Machine balances and ledgers stay exact under concurrency (tested).
  - A retried or duplicated machine operation applies once.
  - A service sale and its machine charge are atomic.
  - Offline and interrupted sales are never silently lost, never shown as recorded before they are, and never recorded twice.
- **Negative / risks:**
  - **Sale time:** a queued sale is recorded with the server's time when it syncs, not the time it was made. A sale made offline at 23:50 and synced after midnight counts on the next day. There is no `client_ts` column; changing that is a schema and reporting decision.
  - **Pricing:** a queued sale is priced at sync time (ADR-0019). If a price changes while the sale waits, the recorded total may differ from what the screen showed. The queue shows the screen's estimate.
  - **Logout:** queued sales stay in this browser's IndexedDB after logout (product names and amounts, no credentials), and sync when the same shop signs in again. Related to audit QA-13.
  - **Transport:** this uses `POST /api/sales` per operation, not the batched `/api/sync/push` with `schema_v` described in `03-data.md` Part 2. The operation and its `opId` are the same, so moving to the batch endpoint later only changes the transport.
  - **Stock figures:** tile stock figures don't reflect queued sales.
- **What changed:**
  - **Server:** `src/server/modules/machines/machines.service.ts`, the `src/app/api/machines/{topup,deduct,adjust}` routes, `src/schemas/machine.ts`, `src/server/modules/sales/sales.service.ts` (service charge), `src/app/api/sales/route.ts` (`STORE_MISMATCH`), `src/server/platform/error.ts`.
  - **Database:** the Prisma schema and the migration.
  - **Client:** `src/client/offline/outbox/*`, the Dexie v4 schema, `src/client/shared/api/{sales,machines}.ts`, `SalesView`, `MachineTopupModal`, `AppShell`, `SyncBar`.
  - **Docs:** `docs/03-data.md`, `docs/01-product.md` (D32).
- **Revisit when:**
  - the batched sync endpoint is built (move the transport);
  - the owner decides D32 or the sale-time question;
  - local stock is modelled offline (apply pending sales optimistically, per §5.4 Rebase).
