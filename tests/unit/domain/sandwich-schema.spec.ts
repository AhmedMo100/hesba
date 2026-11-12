import { describe, expect, it } from "vitest";
import { sandwichInputSchema } from "@/schemas/sandwich";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";

const valid = {
  name: "سندوتش لانشون",
  sellPricePiasters: 1500,
  ingredients: [
    { variantId: V1, quantity: 1, unit: "piece" },
    { variantId: V2, quantity: 5, unit: "g" },
  ],
};

describe("sandwichInputSchema", () => {
  it("accepts a valid sandwich", () => {
    expect(sandwichInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["missing name", { ...valid, name: " " }],
    ["no ingredients", { ...valid, ingredients: [] }],
    ["zero price", { ...valid, sellPricePiasters: 0 }],
    ["fractional piasters", { ...valid, sellPricePiasters: 10.5 }],
    [
      "zero quantity",
      {
        ...valid,
        ingredients: [{ variantId: V1, quantity: 0, unit: "piece" }],
      },
    ],
    [
      "unknown unit",
      { ...valid, ingredients: [{ variantId: V1, quantity: 1, unit: "box" }] },
    ],
    [
      "missing product",
      {
        ...valid,
        ingredients: [{ variantId: "", quantity: 1, unit: "piece" }],
      },
    ],
  ])("rejects %s", (_label, input) => {
    expect(sandwichInputSchema.safeParse(input).success).toBe(false);
  });

  it("rejects a duplicated ingredient with a clear message", () => {
    const res = sandwichInputSchema.safeParse({
      ...valid,
      ingredients: [
        { variantId: V1, quantity: 1, unit: "piece" },
        { variantId: V1, quantity: 2, unit: "piece" },
      ],
    });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toContain("متكرر");
    expect(res.error?.issues[0]?.path).toEqual(["ingredients", 1, "variantId"]);
  });

  it("never accepts a client-supplied cost", () => {
    const res = sandwichInputSchema.parse({ ...valid, costPiasters: 1 });
    expect("costPiasters" in res).toBe(false);
  });
});
