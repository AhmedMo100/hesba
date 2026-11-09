import { describe, it, expect } from "vitest";
import {
  buildStoreAlerts,
  getDaysUntilExpiry,
  NEAR_EXPIRY_DAYS,
  type AlertInventoryRow,
} from "@/domain/alerts";

// Local-time noon, so day arithmetic is stable in any test timezone.
const NOW = new Date(2026, 10, 8, 12, 0, 0);
const inDays = (d: number) => new Date(2026, 10, 8 + d, 9, 0, 0).toISOString();

function row(
  over: Partial<AlertInventoryRow> & { variantId: string },
): AlertInventoryRow {
  return {
    productId: `p-${over.variantId}`,
    productName: `منتج ${over.variantId}`,
    category: "عام",
    unitMode: "piece",
    unit: "piece",
    packQty: 1,
    packName: null,
    sellPricePiasters: 1000,
    buyPricePiasters: 700,
    currentStockBase: 50,
    status: "ok",
    batches: [],
    ...over,
  };
}

const batch = (id: string, days: number | null, remainingQty = 5) => ({
  id,
  remainingQty,
  costPricePiasters: 600,
  expiryDate: days === null ? null : inDays(days),
});

describe("getDaysUntilExpiry", () => {
  it("counts whole calendar days, negative once expired", () => {
    expect(getDaysUntilExpiry(inDays(0), NOW)).toBe(0);
    expect(getDaysUntilExpiry(inDays(3), NOW)).toBe(3);
    expect(getDaysUntilExpiry(inDays(-2), NOW)).toBe(-2);
  });
});

describe("buildStoreAlerts", () => {
  it("classifies out-of-stock (by status or stock ≤ 0) and low stock", () => {
    const r = buildStoreAlerts(
      [
        row({ variantId: "a", status: "out", currentStockBase: 3 }),
        row({ variantId: "b", status: "ok", currentStockBase: 0 }),
        row({ variantId: "c", status: "low", currentStockBase: 2 }),
        row({
          variantId: "d",
          status: "ok",
          productId: null,
          buyPricePiasters: null,
        }),
      ],
      NOW,
    );
    expect(r.outOfStock.map((x) => x.id)).toEqual(["out_a", "out_b"]);
    expect(r.lowStock.map((x) => x.id)).toEqual(["low_c"]);
    expect(r.outOfStock[0]!.buyPricePiasters).toBe(700);
    expect(r.totalStockAlerts).toBe(3);
  });

  it("splits batches into expired and near-expiry, most urgent first, ignoring empty/undated/far batches", () => {
    const r = buildStoreAlerts(
      [
        row({
          variantId: "a",
          batches: [
            batch("x1", -1),
            batch("x2", -5),
            batch("n1", NEAR_EXPIRY_DAYS),
            batch("n2", 0),
            batch("far", NEAR_EXPIRY_DAYS + 1),
            batch("empty", 1, 0),
            batch("undated", null),
          ],
        }),
      ],
      NOW,
    );
    expect(r.expired.map((x) => x.batchId)).toEqual(["x2", "x1"]);
    expect(r.expired.every((x) => x.isExpired)).toBe(true);
    expect(r.nearExpiry.map((x) => x.batchId)).toEqual(["n2", "n1"]);
    expect(r.totalExpiryAlerts).toBe(4);
    expect(r.totalAlerts).toBe(4);
  });

  it("pairs near-expiry items into 20%-off bundles and gives each a 25%-off single offer", () => {
    const r = buildStoreAlerts(
      [
        row({
          variantId: "a",
          sellPricePiasters: 1000,
          batches: [batch("b1", 1)],
        }),
        row({
          variantId: "b",
          sellPricePiasters: 2000,
          batches: [batch("b2", 2)],
        }),
        row({
          variantId: "c",
          sellPricePiasters: 400,
          batches: [batch("b3", 3)],
        }),
      ],
      NOW,
    );
    const bundles = r.suggestedPromotions.filter((p) => p.type === "bundle");
    const singles = r.suggestedPromotions.filter(
      (p) => p.type === "single_discount",
    );

    // Three items → one pair; the odd last item gets no bundle.
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.id).toBe("promo_bundle_a_b");
    expect(bundles[0]!.originalPricePiasters).toBe(3000);
    expect(bundles[0]!.promoPricePiasters).toBe(2400);
    expect(bundles[0]!.savingsPiasters).toBe(600);
    expect(bundles[0]!.expiryDaysMin).toBe(1);

    expect(singles.map((s) => s.id)).toEqual([
      "promo_single_a_b1",
      "promo_single_b_b2",
      "promo_single_c_b3",
    ]);
    expect(singles[0]!.promoPricePiasters).toBe(750);
    expect(singles[2]!.promoPricePiasters).toBe(300);
  });

  it("prices weighed items per kg (500 g in bundles, 1 kg singles) and applies price floors", () => {
    const r = buildStoreAlerts(
      [
        row({
          variantId: "w",
          unitMode: "weight",
          sellPricePiasters: 10000,
          batches: [batch("bw", 0)],
        }),
        row({
          variantId: "t",
          sellPricePiasters: 40,
          batches: [batch("bt", 1)],
        }),
      ],
      NOW,
    );
    const bundle = r.suggestedPromotions.find((p) => p.type === "bundle")!;
    expect(bundle.items[0]!.quantityBase).toBe(500);
    expect(bundle.items[0]!.regularPricePiasters).toBe(5000);
    expect(bundle.items[1]!.quantityBase).toBe(1);

    const weighed = r.suggestedPromotions.find(
      (p) => p.id === "promo_single_w_bw",
    )!;
    expect(weighed.items[0]!.quantityBase).toBe(1000);
    expect(weighed.description).toContain("نهاية اليوم");

    // 40 piasters × 0.75 = 30, raised to the 50-piaster floor.
    const tiny = r.suggestedPromotions.find(
      (p) => p.id === "promo_single_t_bt",
    )!;
    expect(tiny.promoPricePiasters).toBe(50);
    expect(tiny.savingsPiasters).toBe(-10);
  });

  it("returns empty lists for an empty store", () => {
    const r = buildStoreAlerts([], NOW);
    expect(r.totalAlerts).toBe(0);
    expect(r.suggestedPromotions).toEqual([]);
  });
});
