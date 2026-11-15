/**
 * Equivalence tests: inline money formatting patterns found in views
 * must produce the same output as the domain/i18n functions they will replace.
 */
import { describe, expect, it } from "vitest";
import { piastersToEgp, formatPiasters } from "@/domain/money";
import { formatMoney } from "@/client/shared/i18n";

const CASES = [0, 50, 100, 150, 1234567, 999999999] as const;

describe("money format equivalence", () => {
  describe("(piasters / 100).toFixed(2) === piastersToEgp().toFixed(2)", () => {
    for (const p of CASES) {
      it(`piasters=${p}`, () => {
        const inline = (p / 100).toFixed(2);
        const domain = piastersToEgp(p).toFixed(2);
        expect(inline).toBe(domain);
      });
    }
  });

  describe("formatPiasters without currency matches (p/100).toFixed(2)", () => {
    for (const p of CASES) {
      it(`piasters=${p}`, () => {
        const inline = (p / 100).toFixed(2);
        const domain = formatPiasters(p, { includeCurrency: false });
        expect(inline).toBe(domain);
      });
    }
  });

  describe("formatMoney: documents its output for key values", () => {
    it("0 piasters → '0 ج.م' (no decimals for whole)", () => {
      expect(formatMoney(0)).toBe("0 ج.م");
    });
    it("50 piasters → '0.50 ج.م'", () => {
      expect(formatMoney(50)).toBe("0.50 ج.م");
    });
    it("100 piasters → '1 ج.م' (no decimals for whole)", () => {
      expect(formatMoney(100)).toBe("1 ج.م");
    });
    it("1234567 piasters → '12,345.67 ج.م'", () => {
      expect(formatMoney(1234567)).toBe("12,345.67 ج.م");
    });
  });

  describe("inline (p/100).toFixed(2)+' ج.م' differs from formatMoney for whole amounts", () => {
    it("formatMoney drops .00; inline keeps it", () => {
      // This documents the difference so replacements use the right function
      expect(formatMoney(1000)).toBe("10 ج.م");
      expect(`${(1000 / 100).toFixed(2)} ج.م`).toBe("10.00 ج.م");
    });
  });
});
