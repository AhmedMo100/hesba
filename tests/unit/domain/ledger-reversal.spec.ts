/**
 * ADR-0027: a `reversal` entry takes an invoice's debt back (a cancelled purchase, a returned
 * or voided credit sale). It lowers the debt total and is never counted as a payment.
 */
import { describe, expect, it } from "vitest";
import { summarizeLedger, type LedgerEntry } from "@/domain/ledger";

const b = (n: number) => BigInt(n);

describe("ledger reversal kind", () => {
  it("a supplier invoice of 100, paid 30, then cancelled: debt 0, paid 30, credit 30", () => {
    const entries: LedgerEntry[] = [
      { direction: "i_owe", amountPiasters: b(10000), kind: "transaction" },
      { direction: "owed_to_me", amountPiasters: b(3000), kind: "transaction" },
      { direction: "owed_to_me", amountPiasters: b(10000), kind: "reversal" },
    ];
    const s = summarizeLedger("payable", entries);
    expect(s.totalDebt).toBe(b(0));
    expect(s.totalPaid).toBe(b(3000));
    expect(s.balance).toBe(b(-3000)); // the supplier owes the 30 back
    expect(s.balance).toBe(s.totalDebt - s.totalPaid + s.totalAdjustments);
  });

  it("a customer credit invoice of 50, partly returned (20): owes 30, nothing counted as paid", () => {
    const s = summarizeLedger("receivable", [
      { direction: "owed_to_me", amountPiasters: b(5000), kind: "transaction" },
      { direction: "i_owe", amountPiasters: b(2000), kind: "reversal" },
    ]);
    expect(s.balance).toBe(b(3000));
    expect(s.totalDebt).toBe(b(3000));
    expect(s.totalPaid).toBe(b(0));
    expect(s.running).toEqual([b(5000), b(3000)]);
  });
});
