/**
 * The sell sheet reads the product as the stock-in form does (one `entryShape`): the labels,
 * the base quantity and the amount for every way a product is sold — and prices it with the
 * server's own rule.
 */
import { describe, expect, it } from "vitest";
import {
  saleAmount,
  saleBaseNote,
  saleBaseQty,
  saleLineLabel,
  salePriceLine,
  saleQtyLabel,
  saleShape,
} from "@/client/features/sales/sale-quantity";
import type { DisplaySaleItem } from "@/client/features/sales/sales.logic";
import { productEmoji } from "@/client/shared/product-emoji";

const item = (o: Partial<DisplaySaleItem>): DisplaySaleItem => ({
  id: "p",
  variantId: "v",
  productId: "p",
  name: "منتج",
  sellPricePiasters: 1000,
  unitMode: "piece",
  packQty: 1,
  currentStockBase: 100,
  status: "ok",
  unit: "piece",
  ...o,
});

describe("sell sheet by selling method", () => {
  it("a carton product: «عدد الكراتين», the carton's price", () => {
    const it_ = item({ unit: "كرتونة", sellPricePiasters: 8000 });
    const shape = saleShape(it_);
    expect(saleQtyLabel(shape, "base", "kg")).toBe("عدد الكراتين");
    const base = saleBaseQty(shape, "3", "base", "kg");
    expect(base).toBe(3);
    expect(saleAmount(it_, base)).toBe(24000);
    expect(salePriceLine(it_, shape, "base")).toEqual({
      label: "سعر الكرتونة",
      piasters: 8000,
    });
    expect(saleLineLabel(shape, "3", "base", base)).toBe("3 كرتونة");
  });

  it("pieces with a carton of 12: pieces or cartons, priced per piece × 12", () => {
    const it_ = item({
      packQty: 12,
      packName: "carton",
      sellPricePiasters: 1500,
    });
    const shape = saleShape(it_);
    expect(saleQtyLabel(shape, "base", "kg")).toBe("عدد القطع");
    expect(saleQtyLabel(shape, "pack", "kg")).toBe("عدد الكراتين");
    const base = saleBaseQty(shape, "2", "pack", "kg");
    expect(base).toBe(24);
    expect(saleAmount(it_, base)).toBe(36000);
    expect(salePriceLine(it_, shape, "pack")).toEqual({
      label: "سعر الكرتونة",
      piasters: 18000,
    });
    expect(saleBaseNote(shape, base)).toBe("= 24 قطعة");
  });

  it("a jar, a can: their own words", () => {
    expect(
      saleQtyLabel(saleShape(item({ unit: "برطمان" })), "base", "kg"),
    ).toBe("عدد البرطمانات");
    expect(saleQtyLabel(saleShape(item({ unit: "علبة" })), "base", "kg")).toBe(
      "عدد العلب",
    );
  });

  it("a bag of 10 pieces: bags counted, the pieces inside shown", () => {
    const it_ = item({ unit: "bag", sizeValue: 10, sizeUnit: "piece" });
    const shape = saleShape(it_);
    expect(saleQtyLabel(shape, "base", "kg")).toBe("عدد الأكياس");
    const base = saleBaseQty(shape, "2", "base", "kg");
    expect(saleBaseNote(shape, base)).toBe("= 2 كيس (20 قطعة جوه)");
  });

  it("pieces sold loose or by the bag (pack = bag of 10)", () => {
    const it_ = item({ packQty: 10, packName: "كيس", sellPricePiasters: 200 });
    const shape = saleShape(it_);
    expect(saleQtyLabel(shape, "pack", "kg")).toBe("عدد الأكياس");
    expect(saleBaseQty(shape, "3", "base", "kg")).toBe(3);
    expect(saleAmount(it_, saleBaseQty(shape, "1", "pack", "kg"))).toBe(2000);
  });

  it("a kilo product: kilos or grams, price per kilo over grams", () => {
    const it_ = item({
      unit: "kg",
      unitMode: "weight",
      sellPricePiasters: 32000,
    });
    const shape = saleShape(it_);
    expect(shape.kind).toBe("weight");
    expect(saleQtyLabel(shape, "base", "kg")).toBe("الوزن بالكيلو");
    expect(saleQtyLabel(shape, "base", "g")).toBe("الوزن بالجرام");
    expect(saleBaseQty(shape, "0.25", "base", "kg")).toBe(250);
    expect(saleBaseQty(shape, "750", "base", "g")).toBe(750);
    expect(saleAmount(it_, 250)).toBe(8000);
    expect(saleLineLabel(shape, "750", "base", 750)).toBe("750 جرام");
    expect(salePriceLine(it_, shape, "base").piasters).toBe(32000);
  });

  it("a gram product: price per gram, the kilo price shown ×1000", () => {
    const it_ = item({ unit: "g", unitMode: "piece", sellPricePiasters: 30 });
    const shape = saleShape(it_);
    expect(shape.kind).toBe("weight");
    expect(saleAmount(it_, 500)).toBe(15000);
    expect(salePriceLine(it_, shape, "base").piasters).toBe(30000);
  });
});

describe("product tile emoji", () => {
  it("from what the product is, then how it is sold, the scale last", () => {
    expect(productEmoji({ name: "جبنة رومي", unit: "kg", weighed: true })).toBe(
      "🧀",
    );
    expect(productEmoji({ name: "كوكاكولا 1 لتر" })).toBe("🥤");
    expect(productEmoji({ name: "عيش بلدي" })).toBe("🥖");
    expect(productEmoji({ name: "زيت عباد", category: "زيوت وسمن" })).toBe(
      "🫗",
    );
    expect(productEmoji({ name: "حاجة", unit: "برطمان" })).toBe("🫙");
    expect(productEmoji({ name: "حاجة", unit: "كرتونة" })).toBe("📦");
    expect(productEmoji({ name: "حاجة", unit: "kg", weighed: true })).toBe(
      "⚖️",
    );
    expect(productEmoji({ name: "حاجة" })).toBe("📦");
  });
});
