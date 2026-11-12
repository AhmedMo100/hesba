import { describe, expect, it } from "vitest";
import {
  matchScan,
  scoreProduct,
  sizeFromName,
  type SeenProduct,
  type ShopProduct,
} from "@/domain/scan-matcher";

const seen = (o: Partial<SeenProduct>): SeenProduct => ({
  imageIndex: 0,
  brand: null,
  nameAr: null,
  nameEn: null,
  flavor: null,
  sizeValue: null,
  sizeUnit: null,
  packaging: null,
  productType: null,
  quantity: 1,
  confidence: 0.9,
  ...o,
});
let n = 0;
const product = (name: string, o: Partial<ShopProduct> = {}): ShopProduct => ({
  variantId: `v${++n}`,
  productId: `p${n}`,
  name,
  brandAr: null,
  brandEn: null,
  flavor: null,
  sizeValue: null,
  sizeUnit: null,
  packQty: 1,
  unit: "piece",
  sellPricePiasters: 1000,
  stockBase: 10,
  ...o,
});

describe("scan matcher (ADR-0030)", () => {
  it("reads sizes written in Arabic or English product names", () => {
    expect(sizeFromName("بيبسي كانز 330 مل")).toEqual({
      value: 330,
      unit: "ml",
    });
    expect(sizeFromName("مياه ١ لتر")).toEqual({ value: 1, unit: "l" });
    expect(sizeFromName("أرز 5 كيلو")).toEqual({ value: 5, unit: "kg" });
    expect(sizeFromName("Chipsy 40g")).toEqual({ value: 40, unit: "g" });
    expect(sizeFromName("شاي العروسة")).toBeNull();
  });

  it("a conflicting size, flavor or brand excludes a product", () => {
    const cola = seen({
      brand: "Pepsi",
      nameAr: "بيبسي",
      sizeValue: 330,
      sizeUnit: "ml",
    });
    expect(scoreProduct(cola, product("بيبسي 1 لتر"))).toBeNull();
    expect(
      scoreProduct(cola, product("بيبسي", { sizeValue: 1, sizeUnit: "l" })),
    ).toBeNull();
    expect(
      scoreProduct(
        cola,
        product("كولا", { brandEn: "Coca-Cola", brandAr: "كوكاكولا" }),
      ),
    ).toBeNull();
    const cheese = seen({ nameAr: "شيبسي", flavor: "جبنة" });
    expect(
      scoreProduct(cheese, product("شيبسي", { flavor: "شطة" })),
    ).toBeNull();
    // 1000 ml equals 1 l: not a conflict.
    expect(
      scoreProduct(
        seen({ nameAr: "مياه", sizeValue: 1000, sizeUnit: "ml" }),
        product("مياه 1 لتر"),
      ),
    ).toBeGreaterThan(0.7);
  });

  it("confident + clear lead → matched; low model confidence → uncertain; nothing close → unmatched", () => {
    const shop = [
      product("بيبسي كانز 330 مل"),
      product("بيبسي 1 لتر"),
      product("شيبسي جبنة"),
      product("شاي"),
    ];
    const [cola, chips, other] = matchScan(
      [
        seen({
          brand: "Pepsi",
          nameAr: "بيبسي",
          sizeValue: 330,
          sizeUnit: "ml",
          confidence: 0.95,
        }),
        seen({ nameAr: "شيبسي", flavor: "جبنة", confidence: 0.4 }),
        seen({ nameAr: "لبن جهينة", confidence: 0.99 }),
      ],
      shop,
    );
    expect(cola!.status).toBe("matched");
    expect(cola!.candidates[0]!.product.name).toBe("بيبسي كانز 330 مل");
    expect(chips!.status).toBe("uncertain");
    expect(other!.status).toBe("unmatched");
  });

  it("two equally good products are uncertain (no lead), never auto-picked", () => {
    const shop = [product("عصير جهينة مانجو"), product("عصير جهينة جوافة")];
    const [line] = matchScan(
      [seen({ nameAr: "عصير جهينة", confidence: 0.95 })],
      shop,
    );
    expect(line!.status).not.toBe("matched");
    expect(line!.candidates.length).toBe(2);
  });

  it("the same product seen twice is one line with the quantities summed", () => {
    const shop = [product("بيبسي كانز 330 مل")];
    const lines = matchScan(
      [
        seen({
          nameAr: "بيبسي",
          sizeValue: 330,
          sizeUnit: "ml",
          quantity: 2,
          imageIndex: 0,
        }),
        seen({
          nameAr: "بيبسي",
          sizeValue: 330,
          sizeUnit: "ml",
          quantity: 3,
          imageIndex: 1,
        }),
      ],
      shop,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 5, imageIndexes: [0, 1] });
  });

  it("carries the shop's own price, stock and unit, never the model's", () => {
    const shop = [
      product("رز سايب", {
        unit: "kg",
        sellPricePiasters: 4000,
        stockBase: 25_000,
      }),
    ];
    const [line] = matchScan([seen({ nameAr: "رز سايب" })], shop);
    expect(line!.candidates[0]!.product).toMatchObject({
      unit: "kg",
      sellPricePiasters: 4000,
      stockBase: 25_000,
    });
  });
});
