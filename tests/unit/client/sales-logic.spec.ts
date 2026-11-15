import { describe, expect, it } from "vitest";
import {
  generateUuid,
  formatCairoTime,
  getPackLabel,
  getUnitWord,
  formatStockText,
  weightToGrams,
  formatWeightLabel,
  weightSalePiasters,
  getServicesStorageKey,
  type DisplaySaleItem,
} from "@/client/features/sales/sales.logic";

const mockT = (key: string, params?: Record<string, string | number>) => {
  if (key === "sandwich.canMake") return `يعمل ${params?.count}`;
  if (key === "sandwich.notEnough") return "مش كفاية";
  return key;
};

describe("generateUuid", () => {
  it("returns a valid UUID v4 format", () => {
    const id = generateUuid();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateUuid()));
    expect(ids.size).toBe(20);
  });
});

describe("formatCairoTime", () => {
  it("returns a time string for a timestamp", () => {
    const ts = new Date("2026-11-14T14:30:00Z").getTime();
    const result = formatCairoTime(ts);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("getPackLabel", () => {
  it("returns كرتونة by default", () => {
    expect(getPackLabel()).toBe("كرتونة");
  });
  it("returns دستة for qty=12", () => {
    expect(getPackLabel(undefined, 12)).toBe("دستة");
  });
  it("returns كيس for bag", () => {
    expect(getPackLabel("bag")).toBe("كيس");
  });
  it("returns علبة for box", () => {
    expect(getPackLabel("box")).toBe("علبة");
  });
  it("returns the packName when not recognized", () => {
    expect(getPackLabel("شوال")).toBe("شوال");
  });
  it("returns دستة when packName is dozen", () => {
    expect(getPackLabel("dozen")).toBe("دستة");
  });
});

describe("getUnitWord", () => {
  it("returns قطعة by default", () => {
    expect(getUnitWord()).toBe("قطعة");
    expect(getUnitWord("piece")).toBe("قطعة");
    expect(getUnitWord("unit")).toBe("قطعة");
  });
  it("returns علبة for can", () => {
    expect(getUnitWord("can")).toBe("علبة");
  });
  it("returns the unit when not recognized", () => {
    expect(getUnitWord("زجاجة")).toBe("زجاجة");
  });
});

describe("formatStockText", () => {
  const base: DisplaySaleItem = {
    id: "1",
    productId: "p1",
    name: "test",
    sellPricePiasters: 1000,
    unitMode: "piece",
    packQty: 1,
    currentStockBase: 10,
    status: "ok",
  };

  it("shows piece count", () => {
    expect(formatStockText(base, mockT)).toBe("10 قطعة");
  });

  it("shows خلصان for zero stock", () => {
    expect(formatStockText({ ...base, currentStockBase: 0 }, mockT)).toBe(
      "خلصان",
    );
  });

  it("shows weight in kg when >= 1000g", () => {
    expect(
      formatStockText(
        { ...base, unitMode: "weight", currentStockBase: 1500 },
        mockT,
      ),
    ).toBe("1.5 كجم");
  });

  it("shows weight in grams when < 1000g", () => {
    expect(
      formatStockText(
        { ...base, unitMode: "weight", currentStockBase: 500 },
        mockT,
      ),
    ).toBe("500 جرام");
  });

  it("shows cartons and pieces", () => {
    expect(
      formatStockText({ ...base, packQty: 24, currentStockBase: 50 }, mockT),
    ).toBe("2 كرتونة و 2 قطعة");
  });

  it("shows sandwich availability", () => {
    expect(
      formatStockText(
        { ...base, isSandwich: true, currentStockBase: 5 },
        mockT,
      ),
    ).toBe("يعمل 5");
  });

  it("shows sandwich not enough", () => {
    expect(
      formatStockText(
        { ...base, isSandwich: true, currentStockBase: 0 },
        mockT,
      ),
    ).toBe("مش كفاية");
  });

  it("shows service brand name", () => {
    expect(
      formatStockText(
        { ...base, isService: true, brandName: "فوري" },
        mockT,
      ),
    ).toBe("ماكينة فوري");
  });
});

describe("weightToGrams", () => {
  it("converts kg to grams", () => {
    expect(weightToGrams(1.5, "kg")).toBe(1500);
    expect(weightToGrams(0.25, "kg")).toBe(250);
  });
  it("rounds grams to integer", () => {
    expect(weightToGrams(100.6, "gram")).toBe(101);
  });
  it("handles 0", () => {
    expect(weightToGrams(0, "kg")).toBe(0);
  });
});

describe("formatWeightLabel", () => {
  it("formats kg", () => {
    expect(formatWeightLabel(1500)).toBe("1.5 كجم");
  });
  it("formats grams", () => {
    expect(formatWeightLabel(500)).toBe("500 جرام");
  });
});

describe("weightSalePiasters", () => {
  it("computes price for weighed sale", () => {
    // 500g at 2000 piasters/kg = 1000 piasters
    expect(weightSalePiasters(500, 2000)).toBe(1000);
  });
  it("rounds to integer piasters", () => {
    // 333g at 1000 piasters/kg = 333 piasters
    expect(weightSalePiasters(333, 1000)).toBe(333);
  });
});

describe("getServicesStorageKey", () => {
  it("uses storeId when provided", () => {
    expect(getServicesStorageKey("abc")).toBe("hesba_sales_enabled_services_abc");
  });
  it("uses default when no storeId", () => {
    expect(getServicesStorageKey()).toBe("hesba_sales_enabled_services_default");
  });
});
