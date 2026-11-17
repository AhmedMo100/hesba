import { describe, expect, it } from "vitest";
import {
  mergeCheckoutLines,
  offersSaving,
  type CartOffer,
} from "@/client/features/sales/CartSheet";

const offer = (over: Partial<CartOffer> = {}): CartOffer => ({
  promoId: "p1",
  title: "عرض",
  pricePiasters: 2500,
  regularPiasters: 3000,
  items: [
    { variantId: "cola", quantityBase: 2 },
    { variantId: "chips", quantityBase: 1 },
  ],
  qty: 1,
  ...over,
});

describe("offers in an invoice", () => {
  it("adds each offer's items once per quantity, merged with the same products", () => {
    const lines = mergeCheckoutLines(
      [{ variantId: "cola", quantityBase: 1 }],
      [offer({ qty: 2 })],
    );
    expect(lines).toEqual([
      { variantId: "cola", quantityBase: 5 },
      { variantId: "chips", quantityBase: 2 },
    ]);
  });

  it("saves the difference per offer, never negative", () => {
    expect(offersSaving([offer({ qty: 2 })])).toBe(1000);
    expect(offersSaving([offer({ pricePiasters: 4000 })])).toBe(0);
  });

  it("a removed offer leaves nothing behind", () => {
    expect(mergeCheckoutLines([], [])).toEqual([]);
    expect(offersSaving([])).toBe(0);
  });
});
