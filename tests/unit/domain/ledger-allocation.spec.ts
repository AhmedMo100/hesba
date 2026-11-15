import { describe, expect, it } from "vitest";
import {
  allocateLedgerToInvoices,
  type AllocatableEntry,
} from "@/domain/ledger";

let i = 0;
const at = (day: number) => new Date(Date.UTC(2026, 10, day));
const debt = (
  amount: number,
  day: number,
  invoiceId: string | null = null,
): AllocatableEntry => ({
  id: `e${++i}`,
  direction: "owed_to_me",
  amountPiasters: BigInt(amount),
  invoiceId,
  createdAt: at(day),
});
const pay = (
  amount: number,
  day: number,
  invoiceId: string | null = null,
): AllocatableEntry => ({
  id: `e${++i}`,
  direction: "i_owe",
  amountPiasters: BigInt(amount),
  invoiceId,
  createdAt: at(day),
});
const sumOf = (a: ReturnType<typeof allocateLedgerToInvoices>) =>
  [...a.remaining.values()].reduce((n, v) => n + v, BigInt(0)) +
  a.unlinkedRemaining -
  a.credit;

describe("allocateLedgerToInvoices (receivable)", () => {
  it("linked payments stay on their invoice", () => {
    const a = allocateLedgerToInvoices("receivable", [
      debt(100_000, 1, "A"),
      pay(30_000, 1, "A"),
      pay(20_000, 3, "A"),
    ]);
    expect(a.remaining.get("A")).toBe(BigInt(50_000));
  });

  it("a general payment settles the oldest debt first (invoices and unlinked debts by date)", () => {
    const entries = [
      debt(5_000, 1),
      debt(30_000, 2, "A"),
      debt(20_000, 3, "B"),
      pay(40_000, 4),
    ];
    const a = allocateLedgerToInvoices("receivable", entries);
    expect(a.unlinkedRemaining).toBe(BigInt(0));
    expect(a.remaining.get("A")).toBe(BigInt(0));
    expect(a.remaining.get("B")).toBe(BigInt(15_000));
    expect(sumOf(a)).toBe(BigInt(15_000));
  });

  it("over-payment is a visible credit; nothing is negative", () => {
    const a = allocateLedgerToInvoices("receivable", [
      debt(10_000, 1, "A"),
      pay(15_000, 2),
    ]);
    expect(a.remaining.get("A")).toBe(BigInt(0));
    expect(a.credit).toBe(BigInt(5_000));
    expect(sumOf(a)).toBe(BigInt(-5_000));
  });

  it("a return beyond what an invoice still owes moves to the next oldest invoice", () => {
    const a = allocateLedgerToInvoices("receivable", [
      debt(10_000, 1, "A"),
      pay(10_000, 1, "A"),
      pay(4_000, 2, "A"),
      debt(8_000, 3, "B"),
    ]);
    expect(a.remaining.get("A")).toBe(BigInt(0));
    expect(a.remaining.get("B")).toBe(BigInt(4_000));
  });

  it("always adds up to the signed balance", () => {
    for (let k = 0; k < 200; k++) {
      const entries: AllocatableEntry[] = [];
      let balance = BigInt(0);
      for (let j = 0; j < 8; j++) {
        const amount = 1 + Math.floor(Math.random() * 10_000);
        const inv =
          Math.random() < 0.6 ? `I${Math.floor(Math.random() * 3)}` : null;
        if (Math.random() < 0.55) {
          entries.push(debt(amount, j + 1, inv));
          balance += BigInt(amount);
        } else {
          entries.push(pay(amount, j + 1, inv));
          balance -= BigInt(amount);
        }
      }
      const a = allocateLedgerToInvoices("receivable", entries);
      expect(sumOf(a)).toBe(balance);
      for (const v of a.remaining.values()) expect(v >= BigInt(0)).toBe(true);
    }
  });
});
