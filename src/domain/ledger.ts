/**
 * @file ledger.ts
 * @description Pure rules for a person's money ledger (`debt_entries`, ADR-0023, audit QA-12):
 * the signed balance, the running balance, the totals, and the entry that sets a balance.
 *
 * Sign convention — every balance is SIGNED and never floored:
 * - **receivable** (customers, «ليك»): `balance > 0` the customer owes the shop;
 *   `balance < 0` the customer has a credit: the shop owes them (they paid more than they owed).
 * - **payable** (people the shop owes and suppliers, «عليك» / «الموردين»): `balance > 0` the
 *   shop owes them; `balance < 0` the shop paid ahead: they owe the shop (an advance / credit).
 *
 * In the stored entries, `owed_to_me` always adds to what others owe the shop and `i_owe` to
 * what the shop owes. For a receivable the "debt" direction is `owed_to_me`; for a payable it
 * is `i_owe`. A payment is an entry in the other direction.
 *
 * Kinds of entry:
 * - `opening`: the balance a person started with (entered when the person was added);
 * - `transaction`: a real debt or payment;
 * - `adjustment`: the owner set the balance by hand (editing the person). It is labelled as
 *   such and is NOT counted as a debt or a payment in the totals.
 * - `reversal`: a debt taken back because its invoice was cancelled or returned (a cancelled
 *   supplier purchase, a returned credit sale — ADR-0027). It lowers the debt total, and is
 *   never counted as a payment: no money changed hands.
 *
 * Amounts are integer piasters (`bigint`).
 */

export type LedgerSide = "receivable" | "payable";
export type LedgerDirection = "owed_to_me" | "i_owe";
export type LedgerEntryKind =
  "opening" | "transaction" | "adjustment" | "reversal";

export interface LedgerEntry {
  direction: LedgerDirection;
  amountPiasters: bigint;
  kind: LedgerEntryKind;
}

const ZERO = BigInt(0);

/** The direction that increases the balance on this side (a debt). */
export function debtDirection(side: LedgerSide): LedgerDirection {
  return side === "receivable" ? "owed_to_me" : "i_owe";
}

/** The direction of a payment on this side (a collection or a repayment). */
export function paymentDirection(side: LedgerSide): LedgerDirection {
  return side === "receivable" ? "i_owe" : "owed_to_me";
}

/** The entry's effect on the signed balance. */
export function signedAmount(side: LedgerSide, entry: LedgerEntry): bigint {
  return entry.direction === debtDirection(side)
    ? entry.amountPiasters
    : -entry.amountPiasters;
}

export interface LedgerSummary {
  /** Signed: see the sign convention above. */
  balance: bigint;
  /** Σ opening balances and debts, minus reversals (not adjustments). */
  totalDebt: bigint;
  /** Σ payments (not adjustments). */
  totalPaid: bigint;
  /** Σ owner adjustments, signed. */
  totalAdjustments: bigint;
  /** The balance after each entry, in the order given. */
  running: bigint[];
}

/** Sums a ledger in order. `balance = totalDebt − totalPaid + totalAdjustments`. */
export function summarizeLedger(
  side: LedgerSide,
  entries: readonly LedgerEntry[],
): LedgerSummary {
  let balance = ZERO;
  let totalDebt = ZERO;
  let totalPaid = ZERO;
  let totalAdjustments = ZERO;
  const running: bigint[] = [];
  for (const e of entries) {
    const signed = signedAmount(side, e);
    balance += signed;
    if (e.kind === "adjustment") totalAdjustments += signed;
    else if (e.kind === "reversal") totalDebt += signed;
    else if (signed > ZERO) totalDebt += signed;
    else totalPaid -= signed;
    running.push(balance);
  }
  return { balance, totalDebt, totalPaid, totalAdjustments, running };
}

/** What a positive balance is owed, and the credit of a negative one (both ≥ 0). */
export function splitBalance(balance: bigint): {
  outstanding: bigint;
  credit: bigint;
} {
  return balance >= ZERO
    ? { outstanding: balance, credit: ZERO }
    : { outstanding: ZERO, credit: -balance };
}

/**
 * The adjustment entry that moves `current` to `target`, or null when they are equal. The
 * entry is an `adjustment` (labelled as the owner's), never a debt or a payment.
 */
export function adjustmentEntry(
  side: LedgerSide,
  current: bigint,
  target: bigint,
): LedgerEntry | null {
  const diff = target - current;
  if (diff === ZERO) return null;
  return {
    direction: diff > ZERO ? debtDirection(side) : paymentDirection(side),
    amountPiasters: diff > ZERO ? diff : -diff,
    kind: "adjustment",
  };
}

// ---- Invoice allocation (Prompt 2, ADR-0030) -----------------------------------------------

export interface AllocatableEntry {
  direction: LedgerDirection;
  amountPiasters: bigint;
  /** The credit-sale (or purchase) invoice this entry belongs to; null = not tied to one. */
  invoiceId: string | null;
  createdAt: Date;
  id: string;
}

export interface InvoiceAllocation {
  /** What each invoice still owes after every payment, linked or not. Never negative. */
  remaining: Map<string, bigint>;
  /** Debt not tied to an invoice (opening balance, «سجّل عليه»), still unpaid. */
  unlinkedRemaining: bigint;
  /** Paid beyond everything owed: the person's credit. */
  credit: bigint;
}

/**
 * Splits a person's ledger over their invoices. Each invoice owes its own entries (its debt,
 * minus payments and returns linked to it). Money NOT linked to an invoice — a general payment
 * from «ليك», or what an invoice was overpaid — settles the OLDEST open debts first (invoices
 * and unlinked debts by date). The total of `remaining` + `unlinkedRemaining` − `credit` always
 * equals the person's signed balance, so the invoices never disagree with the balance shown.
 */
export function allocateLedgerToInvoices(
  side: LedgerSide,
  entries: readonly AllocatableEntry[],
): InvoiceAllocation {
  const debtDir = debtDirection(side);
  const linked = new Map<string, { owed: bigint; at: Date; id: string }>();
  const unlinkedDebts: Array<{ amount: bigint; at: Date; id: string }> = [];
  let pool = BigInt(0); // unlinked payments, plus any overpayment of an invoice

  for (const e of entries) {
    const signed =
      e.direction === debtDir ? e.amountPiasters : -e.amountPiasters;
    if (e.invoiceId) {
      const cur = linked.get(e.invoiceId);
      if (!cur)
        linked.set(e.invoiceId, { owed: signed, at: e.createdAt, id: e.id });
      else {
        cur.owed += signed;
        if (e.createdAt < cur.at) cur.at = e.createdAt;
      }
    } else if (signed > BigInt(0)) {
      unlinkedDebts.push({ amount: signed, at: e.createdAt, id: e.id });
    } else {
      pool += -signed;
    }
  }

  const items: Array<{
    key: string | null;
    amount: bigint;
    at: Date;
    id: string;
  }> = [];
  for (const [key, v] of linked) {
    if (v.owed > BigInt(0))
      items.push({ key, amount: v.owed, at: v.at, id: v.id });
    else pool += -v.owed; // an invoice paid / returned beyond its total
  }
  for (const d of unlinkedDebts)
    items.push({ key: null, amount: d.amount, at: d.at, id: d.id });
  items.sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id),
  );

  const remaining = new Map<string, bigint>();
  for (const key of linked.keys()) remaining.set(key, BigInt(0));
  let unlinkedRemaining = BigInt(0);
  for (const it of items) {
    const used = pool >= it.amount ? it.amount : pool;
    pool -= used;
    const left = it.amount - used;
    if (it.key) remaining.set(it.key, left);
    else unlinkedRemaining += left;
  }
  return { remaining, unlinkedRemaining, credit: pool };
}
