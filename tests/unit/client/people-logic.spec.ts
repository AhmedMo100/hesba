import { describe, expect, it } from "vitest";
import {
  formatEgp,
  getWaUrl,
  parseCustomerNotes,
  serializeCustomerNotes,
  parseSupplierNotes,
  serializeSupplierNotes,
} from "@/client/features/people/people.logic";

describe("formatEgp", () => {
  it("formats whole piasters without decimals", () => {
    expect(formatEgp(10000)).toBe("100 ج.م");
  });
  it("formats fractional piasters with 2 decimals", () => {
    expect(formatEgp(1050)).toBe("10.50 ج.م");
  });
  it("handles zero", () => {
    expect(formatEgp(0)).toBe("0 ج.م");
  });
  it("formats large amounts with commas", () => {
    expect(formatEgp(1234500)).toBe("12,345 ج.م");
  });
});

describe("getWaUrl", () => {
  it("returns empty for null phone", () => {
    expect(getWaUrl(null, "أحمد", "owedToMe", 5000)).toBe("");
  });
  it("returns empty for empty phone", () => {
    expect(getWaUrl("", "أحمد", "owedToMe", 5000)).toBe("");
  });
  it("prepends 20 to local numbers", () => {
    const url = getWaUrl("01012345678", "أحمد", "owedToMe", 5000);
    expect(url).toContain("wa.me/201012345678");
  });
  it("keeps numbers already starting with 20", () => {
    const url = getWaUrl("201012345678", "أحمد", "owedToMe", 5000);
    expect(url).toContain("wa.me/201012345678");
  });
  it("owedToMe includes debt message", () => {
    const url = getWaUrl("01012345678", "أحمد", "owedToMe", 5000);
    expect(decodeURIComponent(url)).toContain("الحساب المتبقي");
  });
  it("iOwe includes owed message", () => {
    const url = getWaUrl("01012345678", "أحمد", "iOwe", 5000);
    expect(decodeURIComponent(url)).toContain("المستحق لحضرتك");
  });
  it("suppliers get generic message", () => {
    const url = getWaUrl("01012345678", "أحمد", "suppliers", 5000);
    expect(decodeURIComponent(url)).toContain("البضاعة والطلبيات");
  });
  it("non-supplier with zero amount gets greeting only", () => {
    const url = getWaUrl("01012345678", "أحمد", "owedToMe", 0);
    expect(decodeURIComponent(url)).toContain("السلام عليكم يا أحمد.");
    expect(decodeURIComponent(url)).not.toContain("المتبقي");
  });
});

describe("parseCustomerNotes / serializeCustomerNotes", () => {
  it("round-trips products and general note", () => {
    const original = "المنتجات: سكر، أرز\nملاحظة عامة";
    const parsed = parseCustomerNotes(original);
    expect(parsed.products).toEqual(["سكر", "أرز"]);
    expect(parsed.generalNote).toBe("ملاحظة عامة");
    const serialized = serializeCustomerNotes(parsed.products, parsed.generalNote);
    expect(serialized).toBe(original);
  });
  it("handles null", () => {
    expect(parseCustomerNotes(null)).toEqual({ products: [], generalNote: "" });
  });
  it("serializes empty to null", () => {
    expect(serializeCustomerNotes([], "")).toBeNull();
  });
  it("recognizes الأصناف prefix", () => {
    const parsed = parseCustomerNotes("الأصناف: شاي، قهوة");
    expect(parsed.products).toEqual(["شاي", "قهوة"]);
  });
});

describe("parseSupplierNotes / serializeSupplierNotes", () => {
  it("round-trips all fields", () => {
    const original = "عليك ليهم فلوس: 500 جنيه\nليك عندهم منتجات: 3 كرتونة\nتفاصيل أخرى";
    const parsed = parseSupplierNotes(original);
    expect(parsed.owedMoneyNote).toBe("500 جنيه");
    expect(parsed.productsNote).toBe("3 كرتونة");
    expect(parsed.generalNote).toBe("تفاصيل أخرى");
    const serialized = serializeSupplierNotes(parsed);
    expect(serialized).toBe(original);
  });
  it("handles null", () => {
    expect(parseSupplierNotes(null)).toEqual({
      owedMoneyNote: "",
      productsNote: "",
      generalNote: "",
    });
  });
  it("serializes empty to null", () => {
    expect(serializeSupplierNotes({})).toBeNull();
  });
  it("recognizes alternate prefixes", () => {
    const parsed = parseSupplierNotes("فلوس ليهم: 100\nمنتجات عندهم: شاي");
    expect(parsed.owedMoneyNote).toBe("100");
    expect(parsed.productsNote).toBe("شاي");
  });
});
