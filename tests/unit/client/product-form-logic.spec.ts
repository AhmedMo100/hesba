import { describe, expect, it } from "vitest";
import {
  formatPrice,
  packToPiecePrice,
  pieceToPackPrice,
  recalcOnPackQtyChange,
} from "@/client/features/products/product-form.logic";

describe("formatPrice", () => {
  it("formats with 2 decimals", () => {
    expect(formatPrice(12.5)).toBe("12.50");
  });
  it("drops .00 for whole numbers", () => {
    expect(formatPrice(10)).toBe("10");
  });
  it("keeps non-zero decimals", () => {
    expect(formatPrice(3.33)).toBe("3.33");
  });
});

describe("packToPiecePrice", () => {
  it("divides pack price by qty", () => {
    expect(packToPiecePrice("240", "24")).toBe("10");
  });
  it("handles fractional result", () => {
    expect(packToPiecePrice("100", "3")).toBe("33.33");
  });
  it("returns null for invalid input", () => {
    expect(packToPiecePrice("abc", "24")).toBeNull();
    expect(packToPiecePrice("100", "0")).toBeNull();
    expect(packToPiecePrice("100", "")).toBeNull();
  });
});

describe("pieceToPackPrice", () => {
  it("multiplies piece price by qty", () => {
    expect(pieceToPackPrice("10", "24")).toBe("240");
  });
  it("returns null for invalid input", () => {
    expect(pieceToPackPrice("abc", "24")).toBeNull();
  });
});

describe("recalcOnPackQtyChange", () => {
  it("recalcs piece from pack when piece is empty", () => {
    const r = recalcOnPackQtyChange("12", "120", "", "60", "");
    expect(r.pcSell).toBe("10");
    expect(r.pcBuy).toBe("5");
    expect(r.pkSell).toBeUndefined();
    expect(r.pkBuy).toBeUndefined();
  });

  it("recalcs pack from piece when piece is set", () => {
    const r = recalcOnPackQtyChange("12", "", "10", "", "5");
    expect(r.pkSell).toBe("120");
    expect(r.pkBuy).toBe("60");
    expect(r.pcSell).toBeUndefined();
    expect(r.pcBuy).toBeUndefined();
  });

  it("returns empty for invalid qty", () => {
    expect(recalcOnPackQtyChange("0", "100", "", "50", "")).toEqual({});
    expect(recalcOnPackQtyChange("abc", "100", "", "50", "")).toEqual({});
  });
});
