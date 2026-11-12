/**
 * People «ليك» with products: quantities in each product's own selling unit become integer
 * base units with the domain rules (the server then prices and takes the stock).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  lineQuantityBase,
  type PickedLine,
} from "@/client/features/people/ProductLinesPicker";
import { CustomerDebtSheet } from "@/client/features/people/CustomerDebtSheet";

const line = (p: Partial<PickedLine>): PickedLine => ({
  key: "k",
  variantId: "v",
  kg: "",
  packs: "",
  units: "",
  ...p,
});

describe("lineQuantityBase", () => {
  it("weight in kilograms → grams", () => {
    expect(
      lineQuantityBase(line({ kg: "1.5" }), { unitMode: "weight", packQty: 1 }),
    ).toBe(1500);
    expect(
      lineQuantityBase(line({ kg: "٢" }), { unitMode: "weight", packQty: 1 }),
    ).toBe(2000);
  });
  it("cartons of 12 plus loose pieces → pieces", () => {
    expect(
      lineQuantityBase(line({ packs: "2", units: "3" }), {
        unitMode: "piece",
        packQty: 12,
      }),
    ).toBe(27);
  });
  it("no pack: units only; nothing valid → 0", () => {
    expect(
      lineQuantityBase(line({ units: "5", packs: "9" }), {
        unitMode: "piece",
        packQty: 1,
      }),
    ).toBe(5);
    expect(
      lineQuantityBase(line({ units: "-3" }), {
        unitMode: "piece",
        packQty: 1,
      }),
    ).toBe(0);
    expect(
      lineQuantityBase(line({ units: "abc" }), {
        unitMode: "piece",
        packQty: 1,
      }),
    ).toBe(0);
  });
});

describe("CustomerDebtSheet", () => {
  it("opens on an amount, with products as an optional step", () => {
    const html = renderToStaticMarkup(
      <CustomerDebtSheet
        customer={{ id: "c1", name: "أم أحمد" }}
        onClose={() => {}}
        onDone={() => {}}
      />,
    );
    expect(html).toContain("سجّل على أم أحمد (ليك)");
    expect(html).toContain("المبلغ (ج.م)");
    expect(html).toContain("اختار المنتجات (اختياري)");
  });
});
