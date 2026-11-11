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
 *
 * Amounts are integer piasters (`bigint`).
 */

export type LedgerSide = "receivable" | "payable";
export type LedgerDirection = "owed_to_me" | "i_owe";
export type LedgerEntryKind = "opening" | "transaction" | "adjustment";

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
  /** Σ opening balances and debts (not adjustments). */
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
