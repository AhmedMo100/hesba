import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_SANDWICH_SALE_QUANTITY,
  checkSandwichQuantity,
  parseSaleQuantity,
  stepQuantity,
} from "@/client/features/sales/sandwich-quantity";
import { SandwichQuantitySheet } from "@/client/features/sales/SandwichQuantitySheet";

describe("sandwich sale quantity", () => {
  it("parses whole numbers from 1, including Arabic digits", () => {
    expect(parseSaleQuantity("3")).toBe(3);
    expect(parseSaleQuantity("١٢")).toBe(12);
    expect(parseSaleQuantity(" 2 ")).toBe(2);
    for (const bad of ["", "0", "-1", "1.5", "abc", "2 3", "3abc", "٣ج"]) {
      expect(parseSaleQuantity(bad)).toBeNull();
    }
  });

  it("prices the quantity with the shared money rule (integer piasters)", () => {
    expect(checkSandwichQuantity("3", 1250, 10)).toEqual({
      ok: true,
      quantity: 3,
      totalPiasters: 3750,
    });
  });

  it("rejects more than the ingredients can make, or more than the limit", () => {
    expect(checkSandwichQuantity("4", 1000, 3)).toMatchObject({
      ok: false,
      reason: "not_enough",
    });
    expect(
      checkSandwichQuantity(String(MAX_SANDWICH_SALE_QUANTITY + 1), 1000, 5000),
    ).toMatchObject({ ok: false, reason: "too_many" });
    expect(checkSandwichQuantity("x", 1000, 3)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("steps within 1 … available", () => {
    expect(stepQuantity(1, 1, 3)).toBe(2);
    expect(stepQuantity(3, 1, 3)).toBe(3);
    expect(stepQuantity(1, -1, 3)).toBe(1);
    expect(stepQuantity(null, 1, 3)).toBe(2);
    expect(stepQuantity(2, 1, 0)).toBe(1);
  });

  it("renders the quantity step with name, unit price, total and confirm/cancel", () => {
    const html = renderToStaticMarkup(
      <SandwichQuantitySheet
        sandwich={{
          id: "s1",
          name: "سندوتش لانشون",
          sellPricePiasters: 1500,
          availableCount: 4,
        }}
        busy={false}
        error={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("سندوتش لانشون");
    expect(html).toContain("سعر الواحد 15 ج.م");
    expect(html).toContain("يكفي 4");
    expect(html).toMatch(/data-testid="sandwich-qty-total"[^>]*>15 ج.م/);
    expect(html).toContain("تأكيد البيع · 15 ج.م");
    expect(html).toContain("إلغاء");
    expect(html).toContain("مفيش حاجة بتتسجل غير لما تأكد البيع");
  });
});
