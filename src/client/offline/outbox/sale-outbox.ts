/**
 * @file sale-outbox.ts
 * @description The sales outbox (ADR-0020, audit QA-04): every sale is first written to the
 * IndexedDB `outbox` table with a stable `op_id`, then sent to the same authoritative
 * `POST /api/sales` transaction as any online sale. Nothing here weakens the server path:
 * pricing, stock checks, tenant isolation and idempotency are the server's (ADR-0019).
 *
 * Lifecycle (`docs/03-data.md` Part 2 §7):
 *   pending ─send→ sending ─200→ (deleted: applied/duplicate)
 *                          ├─ no answer / 408 / 429 / 5xx → pending, retried with backoff
 *                          │      (after MAX_ATTEMPTS → quarantined, kept for review)
 *                          ├─ 401 → pending (waits for login, not counted as an attempt)
 *                          └─ other 4xx (e.g. 409 not enough stock) → rejected (review)
 *
 * Guarantees:
 * - Durable: the operation is in IndexedDB before anything is sent, so a refresh, a closed
 *   tab or a crash mid-request cannot lose it. An op left `sending` by a closed tab returns to
 *   `pending` the next time a sync runs.
 * - At most once: every attempt sends the same `op_id`; the server returns the first sale for
 *   a repeated `op_id`, so a retry after a lost response never sells twice.
 * - Marked done only after the server's success answer.
 * - One sender at a time across tabs (Web Locks), oldest first.
 * - Tenant: an op is sent only while its own shop is signed in in this tab
 *   (`setActiveOutboxStore`), and carries its shop in `X-Hesba-Store-Id`: if another shop is
 *   signed in on the server (another tab switched accounts), the server refuses it and the op
 *   stays pending. The server always records under the session's shop, never the op's.
 * - No polling: sync runs on events (startup, `online`, tab visible, a new sale, manual) and
 *   one backoff timer after a transient failure (`scheduleSaleSync`).
 */

import { db, type LocalOutboxOp } from "../db";
import {
  postSale,
  SaleApiError,
  type RecordedSale,
  type SaleRequest,
} from "@/client/shared/api/sales";

export const SALE_OP_TYPE = "sale.create";
/** Transient failures before an op is quarantined (kept, shown for review, not auto-sent). */
export const MAX_SYNC_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const LOCK_NAME = "hesba-sale-outbox";

export const OUTBOX_CHANGED_EVENT = "hesba_outbox_changed";
export const SALE_SYNCED_EVENT = "hesba_sale_synced";

/**
 * What the cashier saw when making the sale, for the pending / review list. Display only:
 * `amountPiasters` is the screen's estimate; the server prices the sale when it records it.
 */
export interface SaleOpSummary {
  name: string;
  label: string;
  amountPiasters: number;
  quantity: number;
  category?: string;
  unit?: string;
}

export interface SaleOutboxOp extends LocalOutboxOp {
  type: typeof SALE_OP_TYPE;
  payload: SaleRequest;
  store_id: string;
  summary: SaleOpSummary;
}

/** Result of one send attempt for one op. */
export type SendOutcome =
  | { kind: "applied"; recorded: RecordedSale }
  | { kind: "rejected"; message: string; status: number }
  | { kind: "pending"; message: string; status: number }
  | { kind: "quarantined"; message: string; status: number }
  | { kind: "login"; message: string }
  | { kind: "missing" };

/** Detail of `SALE_SYNCED_EVENT`: a queued sale the server has now recorded. */
export interface SaleSyncedDetail {
  opId: string;
  storeId: string;
  recorded: RecordedSale;
  summary: SaleOpSummary;
  payload: SaleRequest;
}

function emit(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Full-jitter exponential backoff: random(0, min(cap, base × 2^attempts)) + up to 1 s. */
export function backoffDelayMs(attempts: number, random = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempts);
  return Math.floor(random() * ceiling) + Math.floor(random() * 1_000);
}

/** True for answers that may succeed later: no answer, timeout, rate limit, server error. */
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

let lastEnqueueMs = 0;

/**
 * Writes a sale to the outbox (IndexedDB) and resolves once it is durable. The request must
 * carry its `opId`; it is the op's key and is sent unchanged on every attempt.
 */
export async function enqueueSale(args: {
  storeId: string;
  userId?: string;
  request: SaleRequest;
  summary: SaleOpSummary;
}): Promise<SaleOutboxOp> {
  // Strictly increasing within this tab, so "oldest first" keeps the order the sales were made.
  lastEnqueueMs = Math.max(Date.now(), lastEnqueueMs + 1);
  const now = new Date(lastEnqueueMs).toISOString();
  const op: SaleOutboxOp = {
    op_id: args.request.opId,
    type: SALE_OP_TYPE,
    payload: args.request,
    client_ts: now,
    status: "pending",
    attempts: 0,
    last_error: null,
    last_status: null,
    created_at: now,
    next_attempt_at: new Date().toISOString(), // due immediately (real clock)
    store_id: args.storeId,
    user_id: args.userId,
    summary: args.summary,
  };
  await db.outbox.add(op);
  emit(OUTBOX_CHANGED_EVENT);
  return op;
}

/** The shop's queued sales (anything not yet recorded by the server), oldest first. */
export async function listSaleOps(storeId: string): Promise<SaleOutboxOp[]> {
  const ops = await db.outbox.where("store_id").equals(storeId).toArray();
  return (ops as SaleOutboxOp[])
    .filter((o) => o.type === SALE_OP_TYPE)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * The shop last signed in on this device, kept so queued sales can still be listed and new
 * sales queued after an OFFLINE reload (the session request fails offline). Set from a real
 * server session; cleared when the browser is online but signed out. It never authorizes
 * anything: sending always uses the server session, which must be this same shop.
 */
const LAST_STORE_KEY = "hesba_outbox_store";
export function rememberOutboxStore(storeId: string | null): void {
  try {
    if (storeId) localStorage.setItem(LAST_STORE_KEY, storeId);
    else localStorage.removeItem(LAST_STORE_KEY);
  } catch {
    // Storage unavailable: offline queueing after a reload is not possible then.
  }
}
export function lastOutboxStore(): string | undefined {
  try {
    return localStorage.getItem(LAST_STORE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The shop signed in in this tab (set by the app shell; `null` after logout). Sales are only
 * ever sent for this shop, so a retry timer started before an account switch cannot send
 * shop A's sale under shop B's session. `undefined` = not set (tests, no shell).
 */
let activeStoreId: string | null | undefined;
export function setActiveOutboxStore(storeId: string | null | undefined): void {
  activeStoreId = storeId;
}
function isActiveStore(storeId: string): boolean {
  return activeStoreId === undefined || activeStoreId === storeId;
}

/** Runs `fn` while holding the cross-tab outbox lock (in-tab mutex when Web Locks is absent). */
let localChain: Promise<unknown> = Promise.resolve();
async function withOutboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as Navigator & { locks?: LockManager }).locks
      : undefined;
  if (locks?.request) {
    return locks.request(LOCK_NAME, { mode: "exclusive" }, fn) as Promise<T>;
  }
  const run = localChain.then(fn, fn);
  localChain = run.catch(() => undefined);
  return run;
}

/** Inside the lock, a `sending` op can only be left over from a closed tab: send it again. */
async function recoverInterrupted(storeId: string): Promise<void> {
  await db.outbox
    .where("store_id")
    .equals(storeId)
    .and((o) => o.status === "sending")
    .modify({ status: "pending" });
}

/** One attempt for one op. Caller holds the lock. */
async function attempt(
  op: SaleOutboxOp,
  timeoutMs?: number,
): Promise<SendOutcome> {
  await db.outbox.update(op.op_id, { status: "sending" });
  emit(OUTBOX_CHANGED_EVENT);
  try {
    const recorded = await postSale(op.payload, {
      timeoutMs,
      storeId: op.store_id,
    });
    // Recorded (or already recorded: duplicate). Done only now, after the server's answer.
    await db.outbox.delete(op.op_id);
    emit(OUTBOX_CHANGED_EVENT);
    emit(SALE_SYNCED_EVENT, {
      opId: op.op_id,
      storeId: op.store_id,
      recorded,
      summary: op.summary,
      payload: op.payload,
    } satisfies SaleSyncedDetail);
    return { kind: "applied", recorded };
  } catch (err: unknown) {
    const status = err instanceof SaleApiError ? err.status : 0;
    const message = err instanceof Error ? err.message : "";
    const wrongSession =
      err instanceof SaleApiError && err.code === "STORE_MISMATCH";
    if (status === 401 || wrongSession) {
      await db.outbox.update(op.op_id, {
        status: "pending",
        last_error: message,
        last_status: status,
      });
      emit(OUTBOX_CHANGED_EVENT);
      return { kind: "login", message };
    }
    if (isTransientStatus(status)) {
      const attempts = (op.attempts ?? 0) + 1;
      const quarantined = attempts >= MAX_SYNC_ATTEMPTS;
      await db.outbox.update(op.op_id, {
        status: quarantined ? "quarantined" : "pending",
        attempts,
        last_error: message,
        last_status: status,
        next_attempt_at: new Date(
          Date.now() + backoffDelayMs(attempts),
        ).toISOString(),
      });
      emit(OUTBOX_CHANGED_EVENT);
      return quarantined
        ? { kind: "quarantined", message, status }
        : { kind: "pending", message, status };
    }
    // A business or validation rejection: never resent automatically.
    await db.outbox.update(op.op_id, {
      status: "rejected",
      attempts: (op.attempts ?? 0) + 1,
      last_error: message,
      last_status: status,
    });
    emit(OUTBOX_CHANGED_EVENT);
    return { kind: "rejected", message, status };
  }
}

/**
 * Sends one queued sale now (used right after the cashier's tap). Waits for the outbox lock,
 * so it never races a background sync of the same op.
 */
export async function sendSaleOp(
  opId: string,
  storeId: string,
  options: { timeoutMs?: number } = {},
): Promise<SendOutcome> {
  return withOutboxLock(async () => {
    const op = (await db.outbox.get(opId)) as SaleOutboxOp | undefined;
    if (!op) return { kind: "missing" };
    if (op.store_id !== storeId || !isActiveStore(storeId)) {
      // Another shop's operation is never sent under this session.
      return { kind: "missing" };
    }
    if (op.status !== "pending" && op.status !== "sending") {
      return {
        kind: op.status === "quarantined" ? "quarantined" : "rejected",
        message: op.last_error ?? "",
        status: op.last_status ?? 0,
      };
    }
    return attempt(op, options.timeoutMs);
  });
}

export interface SyncReport {
  applied: number;
  rejected: number;
  pending: number;
  stoppedBy?: "offline" | "login";
}

/**
 * Sends the shop's due `pending` sales, oldest first, one at a time. Stops at the first answer
 * that says the network or the session is the problem (the rest would fail the same way).
 */
export async function syncSaleOutbox(
  storeId: string,
  options: { ignoreBackoff?: boolean } = {},
): Promise<SyncReport> {
  const report: SyncReport = { applied: 0, rejected: 0, pending: 0 };
  if (!isActiveStore(storeId)) {
    report.stoppedBy = "login";
    return report;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    report.stoppedBy = "offline";
    report.pending = (await listSaleOps(storeId)).filter(
      (o) => o.status === "pending",
    ).length;
    return report;
  }
  await withOutboxLock(async () => {
    await recoverInterrupted(storeId);
    const now = new Date().toISOString();
    const due = (await listSaleOps(storeId)).filter(
      (o) =>
        o.status === "pending" &&
        (options.ignoreBackoff || (o.next_attempt_at ?? now) <= now),
    );
    for (const op of due) {
      if (!isActiveStore(storeId)) {
        report.stoppedBy = "login";
        break;
      }
      const outcome = await attempt(op);
      if (outcome.kind === "applied") report.applied += 1;
      else if (outcome.kind === "rejected") report.rejected += 1;
      else if (outcome.kind === "login") {
        report.stoppedBy = "login";
        break;
      } else if (outcome.kind === "pending" || outcome.kind === "quarantined") {
        if (outcome.status === 0) {
          report.stoppedBy = "offline";
          break;
        }
      }
    }
  });
  report.pending = (await listSaleOps(storeId)).filter(
    (o) => o.status === "pending",
  ).length;
  return report;
}

let backoffTimer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
/** A sync asked for while another one runs: it runs right after (never dropped). */
let requested: { storeId: string; now: boolean } | null = null;

/**
 * Runs a sync (one at a time per tab) and, if sales are still waiting for a backoff delay,
 * schedules ONE timer for the earliest of them. `now: true` (a tap on "زامن دلوقتي", the
 * browser coming back online, startup / sign-in) sends waiting sales without waiting for
 * backoff. A request made while a sync runs is not dropped: it runs as soon as that sync
 * ends (e.g. the signed-in shop became known during a sync for the previous one). This is
 * retry-after-failure, not polling: no timer exists while the queue is empty or offline.
 */
export function scheduleSaleSync(
  storeId: string | undefined,
  options: { now?: boolean } = {},
): void {
  if (!storeId || typeof window === "undefined") return;
  if (syncing) {
    requested = {
      storeId,
      now:
        Boolean(options.now) ||
        (requested?.storeId === storeId && requested.now),
    };
    return;
  }
  syncing = runSync(storeId, Boolean(options.now));
}

async function runSync(storeId: string, now: boolean): Promise<void> {
  try {
    await syncSaleOutbox(storeId, { ignoreBackoff: now });
  } catch {
    // An unexpected local error: the ops stay in the outbox and the next trigger retries.
  }
  if (backoffTimer) clearTimeout(backoffTimer);
  backoffTimer = null;
  const next = requested;
  requested = null;
  if (next) {
    syncing = runSync(next.storeId, next.now);
    return;
  }
  syncing = null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const waiting = (await listSaleOps(storeId)).filter(
    (o) => o.status === "pending",
  );
  if (waiting.length === 0) return;
  const due = Math.min(
    ...waiting.map((o) => Date.parse(o.next_attempt_at ?? "") || Date.now()),
  );
  backoffTimer = setTimeout(
    () => scheduleSaleSync(storeId),
    Math.max(500, due - Date.now()),
  );
}

/** Puts a rejected / quarantined sale back in the queue with the SAME op_id, and sends it. */
export async function retrySaleOp(
  opId: string,
  storeId: string,
): Promise<void> {
  await db.outbox
    .where("op_id")
    .equals(opId)
    .and((o) => o.store_id === storeId)
    .modify({
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
    });
  emit(OUTBOX_CHANGED_EVENT);
  scheduleSaleSync(storeId);
}

/** Removes a sale the cashier decided not to record (only rejected / quarantined ones). */
export async function dismissSaleOp(
  opId: string,
  storeId: string,
): Promise<void> {
  await db.outbox
    .where("op_id")
    .equals(opId)
    .and(
      (o) =>
        o.store_id === storeId &&
        (o.status === "rejected" || o.status === "quarantined"),
    )
    .delete();
  emit(OUTBOX_CHANGED_EVENT);
}
