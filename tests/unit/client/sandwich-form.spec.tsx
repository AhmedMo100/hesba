import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildSandwichInput,
  ingredientPriority,
  previewSandwich,
  searchIngredientOptions,
  rowsFromSandwich,
  type IngredientRow,
} from "@/client/features/products/sandwich-form";
import { SandwichFormModal } from "@/client/features/products/SandwichFormModal";
import { AddProductChoiceModal } from "@/client/features/products/AddProductChoiceModal";
import { ProductsView } from "@/client/features/products/ProductsView";
import type {
  Sandwich,
  SandwichIngredientOption,
} from "@/client/shared/api/sandwiches";

const BREAD = "11111111-1111-4111-8111-111111111111";
const LUNCHEON = "22222222-2222-4222-8222-222222222222";
const CHEESE = "33333333-3333-4333-8333-333333333333";

const options: SandwichIngredientOption[] = [
  {
    variantId: BREAD,
    productId: "p1",
    name: "عيش",
    unit: "piece",
    isWeight: false,
    buyPricePiasters: 300,
    stockBase: 20,
  },
  {
    variantId: LUNCHEON,
    productId: "p2",
    name: "لانشون",
    unit: "kg",
    isWeight: true,
    buyPricePiasters: 20000,
    stockBase: 1000,
  },
  {
    variantId: CHEESE,
    productId: "p3",
    name: "جبنة",
    unit: "kg",
    isWeight: true,
    buyPricePiasters: 0,
    stockBase: 1000,
  },
];

const row = (
  key: string,
  variantId: string,
  quantity: string,
  unit: IngredientRow["unit"],
): IngredientRow => ({ key, variantId, quantity, unit });

describe("sandwich form preview", () => {
  it("previews line costs, total, profit and margin", () => {
    const p = previewSandwich(
      [row("a", BREAD, "1", "piece"), row("b", LUNCHEON, "5", "g")],
      options,
      "10",
    );
    expect(p.rows.map((r) => r.costPiasters)).toEqual([300, 100]);
    expect(p.costPiasters).toBe(400);
    expect(p.sellPricePiasters).toBe(1000);
    expect(p.profitPiasters).toBe(600);
    expect(p.marginPercent).toBe(60);
  });

  it("updates when quantities change and accepts kilos and Arabic digits", () => {
    const p = previewSandwich(
      [row("a", BREAD, "٢", "piece"), row("b", LUNCHEON, "0.01", "kg")],
      options,
      "",
    );
    expect(p.costPiasters).toBe(600 + 200);
    expect(p.sellPricePiasters).toBe(0);
    expect(p.marginPercent).toBeNull();
  });

  it("flags rows with no product, bad amounts and half grams", () => {
    const p = previewSandwich(
      [
        row("a", "", "1", "piece"),
        row("b", LUNCHEON, "0.5", "g"),
        row("c", BREAD, "1.5", "piece"),
        row("d", CHEESE, "abc", "g"),
      ],
      options,
      "5",
    );
    expect(p.rows.map((r) => r.error)).toEqual([
      "errProduct",
      "errWholeGrams",
      "errWholePieces",
      "errQuantity",
    ]);
  });

  it("flags the second use of the same product as a duplicate", () => {
    const p = previewSandwich(
      [row("a", BREAD, "1", "piece"), row("b", BREAD, "2", "piece")],
      options,
      "5",
    );
    expect(p.rows.map((r) => r.error)).toEqual([undefined, "errDuplicate"]);
    expect(p.costPiasters).toBe(300);
  });

  it("marks an ingredient without a purchase price", () => {
    const p = previewSandwich([row("a", CHEESE, "5", "g")], options, "5");
    expect(p.rows[0]).toMatchObject({ costPiasters: 0, missingCost: true });
  });
});

describe("sandwich form submit", () => {
  it("builds the request body with integer piasters and the chosen units", () => {
    const res = buildSandwichInput(
      "  ساندوتش لانشون ",
      "15.5",
      [row("a", BREAD, "1", "piece"), row("b", LUNCHEON, "5", "g")],
      options,
    );
    expect(res).toEqual({
      ok: true,
      input: {
        name: "ساندوتش لانشون",
        sellPricePiasters: 1550,
        ingredients: [
          { variantId: BREAD, quantity: 1, unit: "piece" },
          { variantId: LUNCHEON, quantity: 5, unit: "g" },
        ],
      },
    });
  });

  it("never sends a cost (the server calculates it)", () => {
    const res = buildSandwichInput(
      "ساندوتش",
      "10",
      [row("a", BREAD, "1", "piece")],
      options,
    );
    expect(res.ok && "costPiasters" in res.input).toBe(false);
  });

  it("returns errors instead of a body when the form is invalid", () => {
    const res = buildSandwichInput("", "", [], options);
    expect(res).toEqual({
      ok: false,
      errors: {
        name: "errName",
        price: "errPrice",
        ingredients: "errNoIngredients",
      },
    });
  });

  it("loads an existing sandwich into rows (weights in grams)", () => {
    const sandwich = {
      ingredients: [
        { variantId: BREAD, quantityBase: 2, isWeight: false },
        { variantId: LUNCHEON, quantityBase: 10, isWeight: true },
      ],
    } as unknown as Sandwich;
    const rows = rowsFromSandwich(sandwich);
    expect(rows.map((r) => [r.variantId, r.quantity, r.unit])).toEqual([
      [BREAD, "2", "piece"],
      [LUNCHEON, "10", "g"],
    ]);
  });
});

describe("sandwich UI", () => {
  it("'إضافة منتج' offers a normal product or a sandwich", () => {
    const html = renderToStaticMarkup(
      <AddProductChoiceModal
        onClose={() => {}}
        onChooseNormal={() => {}}
        onChooseSandwich={() => {}}
      />,
    );
    expect(html).toContain("منتج عادي");
    expect(html).toContain("ساندوتش");
    expect(html).toContain('data-testid="add-choice-normal"');
    expect(html).toContain('data-testid="add-choice-sandwich"');
  });

  it("renders the sandwich form with a read-only calculated cost", () => {
    const html = renderToStaticMarkup(
      <SandwichFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toContain("ساندوتش جديد");
    expect(html).toContain("اسم الساندوتش");
    expect(html).toContain("المكونات");
    expect(html).toContain("تكلفة الساندوتش");
    expect(html).toContain("سعر البيع");
    expect(html).toContain("المكسب");
    expect(html).toContain("حفظ الساندوتش");
    // the cost is shown as text, never as an input
    expect(html).toMatch(/data-testid="sandwich-total-cost"[^>]*>[^<]*0/);
    expect(html).not.toContain('data-testid="sandwich-cost-input"');
  });

  it("always shows the Sandwiches filter chip on the Products screen", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("ساندوتشات");
  });
});

describe("ingredient search and priority ordering", () => {
  const opt = (
    id: string,
    name: string,
    nameEn: string | null = null,
  ): SandwichIngredientOption => ({
    variantId: id,
    productId: `p-${id}`,
    name,
    nameEn,
    unit: "piece",
    isWeight: false,
    buyPricePiasters: 100,
    stockBase: 10,
  });
  const all = [
    opt("bread", "عيش بلدي", "Baladi bread"),
    opt("cola", "بيبسي كانز", "Pepsi Can"),
    opt("mayo", "مايونيز هاينز", "Heinz Mayonnaise"),
    opt("chips", "شيبسي ملح", "Chipsy Salt"),
    opt("roumy", "جبنة رومي", "Roumy Cheese"),
    opt("biscuit", "بسكويت بالجبنة", "Cheese crackers"),
    opt("ketchup", "كاتشب هاينز", "Heinz Ketchup"),
    opt("luncheon", "لانشن بقري", "Beef Luncheon"),
    opt("white", "الجبنه البيضاء", null),
    opt("halawa", "حلاوة طحينية", "Halawa"),
  ];
  const ids = (list: Array<{ variantId: string }>) =>
    list.map((o) => o.variantId);

  it("puts cheese/luncheon first, then chips, then ketchup/mayonnaise, then the rest", () => {
    const sorted = searchIngredientOptions(all, "");
    const groups = sorted.map((o) => o.priority);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(ingredientPriority(opt("x", "جبنة رومي"))).toBe(0);
    expect(ingredientPriority(opt("x", "الجبنه البيضاء"))).toBe(0); // ة/ه and "ال"
    expect(ingredientPriority(opt("x", "لانشن بقري"))).toBe(0); // spelling variant
    expect(ingredientPriority(opt("x", "شيبسي ملح"))).toBe(1);
    expect(ingredientPriority(opt("x", "كاتشب هاينز"))).toBe(2);
    expect(ingredientPriority(opt("x", "مايونيز هاينز"))).toBe(2);
    expect(ingredientPriority(opt("x", "عيش بلدي"))).toBe(3);
    expect(new Set(ids(sorted.slice(0, 3)))).toEqual(
      new Set(["roumy", "white", "luncheon"]),
    );
  });

  it("does not treat a cheese-flavoured biscuit as cheese", () => {
    expect(ingredientPriority(opt("x", "بسكويت بالجبنة"))).toBe(3);
    // ...even though its English catalog name says "Cheese"
    expect(
      ingredientPriority(opt("x", "بسكويت بالجبنة", "Cheese crackers")),
    ).toBe(3);
    // a product whose own name is English is ranked by it
    expect(ingredientPriority(opt("x", "Cheddar cheese"))).toBe(0);
  });

  it("keeps every option exactly once with its original id", () => {
    const sorted = searchIngredientOptions(all, "");
    expect(sorted).toHaveLength(all.length);
    expect(new Set(ids(sorted))).toEqual(new Set(ids(all)));
    expect(all[0]).not.toHaveProperty("priority"); // inputs are not mutated
  });

  it("searches Arabic names ignoring letter variants and diacritics", () => {
    expect(ids(searchIngredientOptions(all, "جبنة"))).toEqual(
      expect.arrayContaining(["roumy", "white", "biscuit"]),
    );
    expect(ids(searchIngredientOptions(all, "الجبنة البيضاء"))).toEqual([
      "white",
    ]);
    expect(ids(searchIngredientOptions(all, "حلاوه"))).toEqual(["halawa"]);
  });

  it("searches English names case-insensitively", () => {
    expect(ids(searchIngredientOptions(all, "heinz"))).toEqual([
      "ketchup",
      "mayo",
    ]);
    expect(ids(searchIngredientOptions(all, "CHIPSY"))).toEqual(["chips"]);
    expect(ids(searchIngredientOptions(all, "beef lunch"))).toEqual([
      "luncheon",
    ]);
  });

  it("applies priority ordering to search results", () => {
    // "هاينز" matches ketchup and mayonnaise (both group 3), "بيبسي" nothing else
    const res = searchIngredientOptions(all, "ن");
    const groups = res.map((o) => o.priority);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(res[0]?.priority).toBe(0);
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchIngredientOptions(all, "زيتون")).toEqual([]);
  });
});
