import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseEgpStrict } from "@/domain/money";
import {
  createPersonInputSchema,
  recordDebtTransactionInputSchema,
} from "@/schemas/people";
import { salesViewConfigUpdateSchema } from "@/schemas/sales-config";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

describe("parseEgpStrict (QA-22)", () => {
  it("one rule: '50', '50.00', 50 and Arabic digits are 50.00 EGP", () => {
    for (const v of ["50", "50.00", "50.0", 50, 50.0, "٥٠", "٥٠٫٠٠", " 50 "]) {
      expect(parseEgpStrict(v)).toBe(5000);
    }
    expect(parseEgpStrict("50.5")).toBe(5050);
    expect(parseEgpStrict("0.50")).toBe(50);
    expect(parseEgpStrict("1,500")).toBe(150000);
    expect(parseEgpStrict(0)).toBe(0);
  });

  it("never guesses: invalid, negative, NaN, Infinity, excess precision are null", () => {
    for (const v of [
      "",
      "abc",
      "-5",
      "50.555",
      "5e3",
      "1.2.3",
      ".5",
      NaN,
      Infinity,
      -1,
      0.1 + 0.2,
    ]) {
      expect(parseEgpStrict(v as number | string)).toBeNull();
    }
  });

  it("any 2-decimal amount round-trips exactly (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_AMOUNT_PIASTERS }), (p) => {
        const text = `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
        expect(parseEgpStrict(text)).toBe(p);
      }),
    );
  });
});

describe("People amounts (QA-22) and sales config (QA-21) schemas", () => {
  it("amountPiasters is integer piasters only; amountEgp is pounds; not both", () => {
    const base = { name: "x", section: "owedToMe" as const };
    expect(
      createPersonInputSchema.parse({ ...base, amountPiasters: 5000 })
        .amountPiasters,
    ).toBe(5000);
    expect(
      createPersonInputSchema.parse({ ...base, amountEgp: "50" })
        .amountPiasters,
    ).toBe(5000);
    expect(createPersonInputSchema.parse(base).amountPiasters).toBe(0);
    for (const bad of [
      { amountPiasters: "50" },
      { amountPiasters: 10.7 },
      { amountPiasters: MAX_AMOUNT_PIASTERS + 1 },
      { amountEgp: "50", amountPiasters: 5000 },
    ]) {
      expect(
        createPersonInputSchema.safeParse({ ...base, ...bad }).success,
      ).toBe(false);
    }
    expect(
      recordDebtTransactionInputSchema.safeParse({
        type: "payment",
        amountEgp: "0",
      }).success,
    ).toBe(false);
    expect(
      recordDebtTransactionInputSchema.parse({
        type: "payment",
        amountEgp: "30.50",
      }).amountPiasters,
    ).toBe(3050);
  });

  it("sales config: partial, strict, never empty", () => {
    expect(
      salesViewConfigUpdateSchema.parse({ enabledServiceIds: ["a"] }),
    ).toEqual({ enabledServiceIds: ["a"] });
    for (const bad of [
      {},
      { x: 1 },
      { enabledServiceIds: "a" },
      { enabledServiceIds: [1] },
      [1],
      null,
    ]) {
      expect(salesViewConfigUpdateSchema.safeParse(bad).success).toBe(false);
    }
  });
});
