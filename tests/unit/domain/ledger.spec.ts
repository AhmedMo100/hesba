import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  adjustmentEntry,
  splitBalance,
  summarizeLedger,
  type LedgerEntry,
} from "@/domain/ledger";

const b = (n: number) => BigInt(n);
const debt = (
  n: number,
  kind: LedgerEntry["kind"] = "transaction",
): LedgerEntry => ({ direction: "owed_to_me", amountPiasters: b(n), kind });
const pay = (n: number): LedgerEntry => ({
  direction: "i_owe",
  amountPiasters: b(n),
  kind: "transaction",
});

describe("people ledger rules (ADR-0023, QA-12)", () => {
  it("keeps an overpayment as a signed credit and sets later debts against it", () => {
    const s = summarizeLedger("receivable", [
      debt(10_000, "opening"),
      pay(3_000),
      pay(1_000),
      pay(1_000),
      pay(999_999),
      debt(100),
    ]);
    expect(Number(s.balance)).toBe(-994_899);
    expect(s.running.map(Number)).toEqual([
      10_000, 7_000, 6_000, 5_000, -994_999, -994_899,
    ]);
    expect(splitBalance(s.balance)).toEqual({
      outstanding: b(0),
      credit: b(994_899),
    });
  });

  it("a payable's sign is the shop's debt", () => {
    const s = summarizeLedger("payable", [
      { direction: "i_owe", amountPiasters: b(3_000), kind: "opening" },
      {
        direction: "owed_to_me",
        amountPiasters: b(5_000),
        kind: "transaction",
      },
    ]);
    expect(Number(s.balance)).toBe(-2_000);
  });

  it("an owner adjustment sets the balance and is not counted as a debt or a payment", () => {
    const entries = [debt(10_000, "opening"), pay(2_000)];
    const adj = adjustmentEntry("receivable", b(8_000), b(15_000))!;
    expect(adj).toEqual({
      direction: "owed_to_me",
      amountPiasters: b(7_000),
      kind: "adjustment",
    });
    const s = summarizeLedger("receivable", [...entries, adj]);
    expect(Number(s.balance)).toBe(15_000);
    expect(Number(s.totalDebt)).toBe(10_000);
    expect(Number(s.totalPaid)).toBe(2_000);
    expect(Number(s.totalAdjustments)).toBe(7_000);
    expect(adjustmentEntry("receivable", b(5), b(5))).toBeNull();
  });

  it("balance = debts − payments + adjustments, and an adjustment always reaches its target (property)", () => {
    const entry = fc.record({
      direction: fc.constantFrom("owed_to_me" as const, "i_owe" as const),
      amountPiasters: fc.bigInt({ min: b(1), max: b(10_000_000) }),
      kind: fc.constantFrom(
        "opening" as const,
        "transaction" as const,
        "adjustment" as const,
      ),
    });
    fc.assert(
      fc.property(
        fc.constantFrom("receivable" as const, "payable" as const),
        fc.array(entry, { maxLength: 30 }),
        fc.bigInt({ min: b(-10_000_000), max: b(10_000_000) }),
        (side, entries, target) => {
          const s = summarizeLedger(side, entries);
          expect(s.balance).toBe(
            s.totalDebt - s.totalPaid + s.totalAdjustments,
          );
          const adj = adjustmentEntry(side, s.balance, target);
          const after = summarizeLedger(
            side,
            adj ? [...entries, adj] : entries,
          );
          expect(after.balance).toBe(target);
        },
      ),
    );
  });
});
