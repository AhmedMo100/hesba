import { describe, expect, it } from "vitest";
import {
  applyDiscount,
  assertIntegerPiasters,
  calculateLineTotal,
  egpToPiasters,
  formatPiasters,
  piastersToEgp,
} from "@/domain/money";

describe("domain/money - integer piaster arithmetic", () => {
  it("converts EGP to integer piasters with precision", () => {
    expect(egpToPiasters(10.5)).toBe(1050);
    expect(egpToPiasters(0.75)).toBe(75);
    expect(egpToPiasters(100)).toBe(10000);
    expect(egpToPiasters(25.99)).toBe(2599);
  });

  it("converts integer piasters to decimal EGP", () => {
    expect(piastersToEgp(1050)).toBe(10.5);
    expect(piastersToEgp(75)).toBe(0.75);
    expect(piastersToEgp(10000)).toBe(100);
  });

  it("formats piasters correctly for display", () => {
    expect(formatPiasters(1550, { locale: "ar-EG" })).toBe("15.50 ج.م");
    expect(formatPiasters(1550, { locale: "en-US" })).toBe("15.50 EGP");
    expect(formatPiasters(500, { includeCurrency: false })).toBe("5.00");
  });

  it("calculates line item total in piasters", () => {
    // 3 items at 12.50 EGP (1250 piasters) = 37.50 EGP (3750 piasters)
    expect(calculateLineTotal(1250, 3)).toBe(3750);
    // 0 items
    expect(calculateLineTotal(1250, 0)).toBe(0);
  });

  it("applies percentage discount in integer piasters", () => {
    // 1000 piasters with 10% discount -> 900 piasters
    expect(applyDiscount(1000, 10)).toBe(900);
    // 1550 piasters with 15% discount -> 1550 - round(232.5) = 1550 - 233 = 1317
    expect(applyDiscount(1550, 15)).toBe(1317);
    // 100% discount
    expect(applyDiscount(5000, 100)).toBe(0);
    // 0% discount
    expect(applyDiscount(5000, 0)).toBe(5000);
  });

  it("strictly enforces integer amounts and rejects floats", () => {
    expect(() => assertIntegerPiasters(12.5)).toThrow(TypeError);
    expect(() => calculateLineTotal(12.5, 2)).toThrow(TypeError);
    expect(() => calculateLineTotal(1250, 2.5)).toThrow(TypeError);
    expect(() => piastersToEgp(10.2)).toThrow(TypeError);
    expect(() => applyDiscount(12.5, 10)).toThrow(TypeError);
    expect(() => applyDiscount(1000, 150)).toThrow(RangeError);
  });
});
