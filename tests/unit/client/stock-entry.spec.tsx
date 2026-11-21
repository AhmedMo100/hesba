import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/client/shared/ui";
import { StockEntrySheet } from "@/client/features/stock/StockEntrySheet";
import {
  entryShape,
  entryTotals,
  optionFromProduct,
  registeredPrices,
  type StockProductOption,
} from "@/client/features/stock/stock-entry.logic";
import type { StoreProductItem } from "@/client/shared/store-items";

const product = (
  unit: string,
  v: Partial<StoreProductItem["variants"][number]> = {},
  extra: Partial<StoreProductItem> = {},
): StoreProductItem => ({
  id: "p1",
  name_ar: "منتج",
  category: "بقالة",
  unit,
  sell_price_piasters: 2000,
  buy_cost_piasters: 1500,
  is_custom: true,
  variants: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      pack_qty: 1,
      sell_price_piasters: 2000,
      buy_cost_piasters: 1500,
      ...v,
    },
  ],
  ...extra,
});

const blank = {
  packs: "",
  units: "",
  weight: "",
  weightUnit: "kg" as const,
  unitPrice: "",
  packPrice: "",
};

const render = (opt: StockProductOption) =>
  renderToStaticMarkup(
    <ToastProvider>
      <StockEntrySheet
        option={opt}
        batches={[]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </ToastProvider>,
  );

describe("stock entry: the fields follow how the product is sold", () => {
  it("piece only: count, piece price, total", () => {
    const shape = entryShape(optionFromProduct(product("piece")));
    expect(shape).toMatchObject({
      kind: "count",
      one: "قطعة",
      plural: "القطع",
      pack: null,
      content: null,
    });
    const t = entryTotals(shape, { ...blank, units: "10", unitPrice: "15" });
    expect(t).toMatchObject({
      baseQty: 10,
      totalPiasters: 15000,
      qtyText: "10 قطعة",
    });
  });

  it("jar and can: their own words", () => {
    expect(entryShape(optionFromProduct(product("برطمان")))).toMatchObject({
      one: "برطمان",
      plural: "البرطمانات",
    });
    expect(entryShape(optionFromProduct(product("علبة")))).toMatchObject({
      one: "علبة",
      plural: "العلب",
    });
    expect(entryShape(optionFromProduct(product("كرتونة")))).toMatchObject({
      one: "كرتونة",
      plural: "الكراتين",
      pack: null,
    });
  });

  it("carton + piece: packs and loose units, linked prices, one total", () => {
    const opt = optionFromProduct(
      product("piece", { pack_qty: 12, size_unit: "carton" }),
    );
    const shape = entryShape(opt);
    expect(shape).toMatchObject({
      kind: "count",
      pack: { qty: 12, one: "كرتونة", plural: "الكراتين" },
    });
    expect(registeredPrices(shape, opt.buyCostPiasters)).toEqual({
      unitPrice: "15",
      packPrice: "180",
    });
    const t = entryTotals(shape, {
      ...blank,
      packs: "2",
      units: "3",
      unitPrice: "15",
      packPrice: "170",
    });
    // 2 × 170 (the carton's own price) + 3 × 15
    expect(t).toMatchObject({
      baseQty: 27,
      totalPiasters: 38500,
      qtyText: "2 كرتونة و 3 قطعة",
    });
  });

  it("bag of pieces: bags, what one holds, all pieces", () => {
    const shape = entryShape(
      optionFromProduct(product("bag", { size_value: 10, size_unit: "piece" })),
    );
    expect(shape).toMatchObject({
      one: "كيس",
      content: { amount: 10, unit: "piece" },
    });
    expect(
      entryTotals(shape, { ...blank, units: "5", unitPrice: "20" }),
    ).toMatchObject({
      baseQty: 5,
      totalPiasters: 10000,
      contentText: "50 قطعة",
    });
  });

  it("bag by weight: bags, bag weight, total weight", () => {
    const shape = entryShape(
      optionFromProduct(product("bag", { size_value: 500, size_unit: "g" })),
    );
    expect(shape).toMatchObject({ content: { amount: 500, unit: "g" } });
    expect(entryTotals(shape, { ...blank, units: "5" }).contentText).toBe(
      "2.5 كيلو",
    );
  });

  it("weight: grams in stock, price per chosen unit", () => {
    const opt = optionFromProduct(
      product("kg", {}, { buy_cost_piasters: 24000 }),
      undefined,
    );
    const shape = entryShape({ ...opt, buyCostPiasters: 24000 });
    expect(shape.kind).toBe("weight");
    expect(registeredPrices(shape, 24000, "kg").unitPrice).toBe("240");
    expect(registeredPrices(shape, 24000, "g").unitPrice).toBe("0.24");
    expect(
      entryTotals(shape, { ...blank, weight: "2.5", unitPrice: "240" }),
    ).toMatchObject({
      baseQty: 2500,
      totalPiasters: 60000,
      qtyText: "2.5 كيلو",
    });
    expect(
      entryTotals(shape, {
        ...blank,
        weight: "750",
        weightUnit: "g",
        unitPrice: "0.24",
      }),
    ).toMatchObject({
      baseQty: 750,
      totalPiasters: 18000,
    });
  });

  it("never invents a 12-pack for a product without one", () => {
    const opt = optionFromProduct(product("piece", { pack_qty: undefined }));
    expect(opt.packQty).toBe(1);
    expect(entryShape(opt)).toMatchObject({ pack: null });
  });
});

describe("StockEntrySheet (V19 buy sheet)", () => {
  it("jar: jar labels, jar price, total, expiry, cash / machines / «آجل لمورد»", () => {
    const html = render(optionFromProduct(product("برطمان")));
    expect(html).toContain("عدد البرطمانات");
    expect(html).toContain("سعر شراء البرطمان");
    expect(html).toContain("تكلفة الكمية كلها");
    expect(html).toContain("تاريخ صلاحية الدفعة دي");
    expect(html).toContain("💵 كاش");
    expect(html).toContain("📒 آجل لمورد");
    expect(html).not.toContain("آجل على مورد");
    expect(html).not.toContain("عدد الكراتين");
  });

  it("carton + piece: both counts, both prices, the relation", () => {
    const html = render(
      optionFromProduct(
        product("piece", { pack_qty: 12, size_unit: "carton" }),
      ),
    );
    expect(html).toContain("عدد الكراتين");
    expect(html).toContain("قطع زيادة");
    expect(html).toContain("الكرتونة = 12 قطعة");
    expect(html).toContain("سعر شراء الكرتونة");
    expect(html).toContain("سعر شراء القطعة");
    expect(html).toContain('value="180"');
  });

  it("weight: weight with kilo / gram, price per kilo", () => {
    const html = render(optionFromProduct(product("kg")));
    expect(html).toContain("الوزن اللي دخل");
    expect(html).toContain("كيلو");
    expect(html).toContain("جرام");
    expect(html).toContain("سعر شراء الكيلو");
    expect(html).not.toContain("عدد القطع");
  });
});
