import { describe, expect, it } from "vitest";
import {
  assertIntegerBaseQuantity,
  formatWeight,
  gramsToKilograms,
  kilogramsToGrams,
  packsToPieces,
  piecesToPacks,
} from "@/domain/units";

describe("domain/units - integer base unit quantities", () => {
  it("converts grams to kilograms and vice versa", () => {
    expect(gramsToKilograms(1500)).toBe(1.5);
    expect(gramsToKilograms(250)).toBe(0.25);
    expect(gramsToKilograms(5000)).toBe(5);

    expect(kilogramsToGrams(1.5)).toBe(1500);
    expect(kilogramsToGrams(0.25)).toBe(250);
    expect(kilogramsToGrams(0.125)).toBe(125);
  });

  it("converts packs to pieces and pieces to packs with remainder", () => {
    // 2 cartons of 24 pieces = 48 pieces
    expect(packsToPieces(2, 24)).toBe(48);
    expect(packsToPieces(0, 24)).toBe(0);

    // 50 pieces with carton of 24 = 2 cartons + 2 pieces
    const result1 = piecesToPacks(50, 24);
    expect(result1.packs).toBe(2);
    expect(result1.remainderPieces).toBe(2);

    // 24 pieces with carton of 24 = 1 carton + 0 pieces
    const result2 = piecesToPacks(24, 24);
    expect(result2.packs).toBe(1);
    expect(result2.remainderPieces).toBe(0);

    // 10 pieces with carton of 24 = 0 cartons + 10 pieces
    const result3 = piecesToPacks(10, 24);
    expect(result3.packs).toBe(0);
    expect(result3.remainderPieces).toBe(10);
  });

  it("formats weight properly for Arabic and English locales", () => {
    expect(formatWeight(1500, { locale: "ar-EG" })).toBe("1.5 كجم");
    expect(formatWeight(1500, { locale: "en-US" })).toBe("1.5 kg");
    expect(formatWeight(500, { locale: "ar-EG" })).toBe("500 جم");
    expect(formatWeight(500, { locale: "en-US" })).toBe("500 g");
    expect(formatWeight(2000, { locale: "ar-EG" })).toBe("2 كجم");
  });

  it("enforces safe integer base quantities", () => {
    expect(() => assertIntegerBaseQuantity(1.5)).toThrow(TypeError);
    expect(() => gramsToKilograms(12.3)).toThrow(TypeError);
    expect(() => packsToPieces(1.5, 24)).toThrow(TypeError);
    expect(() => packsToPieces(2, 0)).toThrow(RangeError);
    expect(() => piecesToPacks(50, -5)).toThrow(RangeError);
  });
});
