import { describe, expect, it } from "vitest";
import {
  fmtMoney,
  sandwichSubtitle,
  isWeightProduct,
  packCount,
  getServiceNature,
} from "@/client/features/products/products.logic";
import type { StoreProductItem } from "@/client/shared/store-items";

const mockT = (key: string, params?: Record<string, string | number>) => {
  if (key === "sandwich.category") return "سندوتشات";
  if (key === "sandwich.ingredientsCount") return `${params?.count} مكون`;
  if (key === "sandwich.canMake") return `يعمل ${params?.count}`;
  return key;
};

describe("fmtMoney", () => {
  it("formats positive piasters as pounds", () => {
    expect(fmtMoney(1550)).toBe("15.5");
    expect(fmtMoney(100)).toBe("1");
    expect(fmtMoney(1234567)).toBe("12,345.67");
  });
  it("returns — for zero or negative", () => {
    expect(fmtMoney(0)).toBe("—");
    expect(fmtMoney(-100)).toBe("—");
  });
});

describe("sandwichSubtitle", () => {
  it("returns category for undefined sandwich", () => {
    expect(sandwichSubtitle(undefined, mockT)).toBe("سندوتشات");
  });
  it("returns ingredients count and available", () => {
    const sw = { ingredients: [1, 2, 3] as unknown[], availableCount: 5 };
    expect(sandwichSubtitle(sw as never, mockT)).toBe("3 مكون · يعمل 5");
  });
});

describe("isWeightProduct", () => {
  it("detects weight products", () => {
    expect(isWeightProduct({ unit: "weight" } as StoreProductItem)).toBe(true);
    expect(isWeightProduct({ unit: "kg" } as StoreProductItem)).toBe(true);
    expect(isWeightProduct({ unit: "g" } as StoreProductItem)).toBe(true);
  });
  it("rejects piece products", () => {
    expect(isWeightProduct({ unit: "piece" } as StoreProductItem)).toBe(false);
  });
});

describe("packCount", () => {
  it("returns pack qty when > 1", () => {
    expect(
      packCount({
        unit: "piece",
        variants: [{ pack_qty: 24 }],
      } as unknown as StoreProductItem),
    ).toBe(24);
  });
  it("returns 0 for weight products", () => {
    expect(
      packCount({
        unit: "kg",
        variants: [{ pack_qty: 24 }],
      } as unknown as StoreProductItem),
    ).toBe(0);
  });
  it("returns 0 when pack_qty is 1", () => {
    expect(
      packCount({
        unit: "piece",
        variants: [{ pack_qty: 1 }],
      } as unknown as StoreProductItem),
    ).toBe(0);
  });
});

describe("getServiceNature", () => {
  it("classifies كروت شحن as stock", () => {
    const r = getServiceNature({ category: "كروت شحن" } as StoreProductItem);
    expect(r).toEqual({ label: "كارت فيزيائي (مخزون)", isStock: true });
  });
  it("classifies شحن رصيد as non-stock", () => {
    const r = getServiceNature({ category: "شحن رصيد" } as StoreProductItem);
    expect(r).toEqual({ label: "شحن رصيد مباشر", isStock: false });
  });
  it("defaults to خدمة رقمية", () => {
    const r = getServiceNature({ category: "أخرى" } as StoreProductItem);
    expect(r).toEqual({ label: "خدمة رقمية", isStock: false });
  });
});
