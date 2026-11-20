/**
 * The return form reads quantities in the product's own unit (whole pieces / cartons, kilos to
 * the gram), its value is the server's own rule, stock value is exact, and money prints from
 * integers.
 */
import { describe, expect, it } from "vitest";
import {
  describeBase,
  returnBase,
  saleShape,
} from "@/client/features/sales/sale-quantity";
import type { DisplaySaleItem } from "@/client/features/sales/sales.logic";
import { returnValue } from "@/domain/sale-return";
import { stockValuePiasters } from "@/domain/stock/stock-value";
import { formatMoney } from "@/client/shared/i18n";

const item = (o: Partial<DisplaySaleItem>): DisplaySaleItem => ({
  id: "l",
  productId: "p",
  name: "x",
  sellPricePiasters: 1000,
  unitMode: "piece",
  packQty: 1,
  currentStockBase: 0,
  status: "ok",
  unit: "piece",
  ...o,
});

describe("return quantities", () => {
  it("kilos to the gram, grams whole", () => {
    const s = saleShape(item({ unit: "kg", unitMode: "weight" }));
    expect(returnBase(s, "1.25", "base", "kg")).toEqual({ base: 1250 });
    expect(returnBase(s, "0.001", "base", "kg")).toEqual({ base: 1 });
    expect(returnBase(s, "1.2345", "base", "kg")).toHaveProperty("error");
    expect(returnBase(s, "750", "base", "g")).toEqual({ base: 750 });
    expect(describeBase(s, 4250)).toBe("4.25 كيلو");
    expect(describeBase(s, 250)).toBe("250 جرام");
  });

  it("whole pieces and cartons; a carton of 12 is 12 pieces", () => {
    const s = saleShape(item({ packQty: 12, packName: "carton" }));
    expect(returnBase(s, "1", "pack", "kg")).toEqual({ base: 12 });
    expect(returnBase(s, "3", "base", "kg")).toEqual({ base: 3 });
    expect(returnBase(s, "0.5", "base", "kg")).toHaveProperty("error");
    expect(returnBase(s, "-1", "base", "kg")).toHaveProperty("error");
    expect(returnBase(s, "0", "base", "kg")).toHaveProperty("error");
    expect(describeBase(s, 27)).toBe("2 كرتونة و 3 قطعة");
  });

  it("the value of a return in several steps adds up to the line exactly", () => {
    const total = BigInt(176000);
    const parts = [1250, 1000, 3250].reduce<{ prev: number; sum: bigint }>(
      (acc, q) => ({
        prev: acc.prev + q,
        sum: acc.sum + returnValue(total, 5500, acc.prev, q),
      }),
      { prev: 0, sum: BigInt(0) },
    );
    expect(returnValue(total, 5500, 0, 1250)).toBe(BigInt(40000));
    expect(parts.sum).toBe(total);
  });
});

describe("stock value and money text", () => {
  it("values stock like a sale line", () => {
    expect(stockValuePiasters("kg", 1250, 32000)).toBe(40000);
    expect(stockValuePiasters("g", 500, 30)).toBe(15000);
    expect(stockValuePiasters("piece", 3, 1250)).toBe(3750);
    expect(stockValuePiasters("piece", 0, 1250)).toBe(0);
  });

  it("prints piasters from integers", () => {
    expect(formatMoney(52975)).toBe("529.75 ج.م");
    expect(formatMoney(-1275)).toBe("-12.75 ج.م");
    expect(formatMoney(100000)).toBe("1,000 ج.م");
    expect(formatMoney(5)).toBe("0.05 ج.م");
  });
});
