import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BarcodeScanSheet } from "@/client/shared/scanner/BarcodeScanSheet";
import {
  findByBarcode,
  matchesSaleFilter,
  type DisplaySaleItem,
} from "@/client/features/sales/sales.logic";

const item = (over: Partial<DisplaySaleItem>): DisplaySaleItem =>
  ({
    id: "p",
    productId: "p",
    name: "منتج",
    sellPricePiasters: 1000,
    unitMode: "piece",
    packQty: 1,
    currentStockBase: 5,
    status: "ok",
    isService: false,
    ...over,
  }) as DisplaySaleItem;

describe("barcode scanner (no AI)", () => {
  it("opens on the camera straight away: no mode screen, no AI quota", () => {
    const html = renderToStaticMarkup(
      <BarcodeScanSheet onCode={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain("📷 امسح الباركود");
    expect(html).toContain('data-testid="barcode-video"');
    expect(html).toContain("بنفتح الكاميرا");
    expect(html).toContain("إلغاء");
    expect(html).not.toMatch(/اسكان|quota|متبقي/);
  });

  it("finds the product by the shop's own barcode only", () => {
    const items = [
      item({ id: "a", barcodes: ["6221000000011"] }),
      item({ id: "b", barcodes: [] }),
      item({ id: "s", isService: true, barcodes: ["6221000000011"] }),
    ];
    expect(findByBarcode(items, " 6221000000011 ")?.id).toBe("a");
    expect(findByBarcode(items, "999")).toBeUndefined();
    expect(findByBarcode(items, "")).toBeUndefined();
  });
});

describe("sale filters under «المنتجات»", () => {
  const sand = item({ id: "sw", isSandwich: true });
  const svc = item({ id: "sv", isService: true });
  const kg = item({ id: "kg", unitMode: "weight" });
  const bc = item({ id: "bc", hasBarcode: true });
  const plain = item({ id: "pl" });
  const all = [sand, svc, kg, bc, plain];
  const ids = (f: Parameters<typeof matchesSaleFilter>[1]) =>
    all.filter((i) => matchesSaleFilter(i, f)).map((i) => i.id);

  it("الكل = every product, services have their own card", () => {
    expect(ids("all")).toEqual(["sw", "kg", "bc", "pl"]);
    expect(ids("svc")).toEqual(["sv"]);
  });
  it("بالوزن / من غير باركود / الساندوتشات", () => {
    expect(ids("weight")).toEqual(["kg"]);
    expect(ids("nobc")).toEqual(["kg", "pl"]);
    expect(ids("sand")).toEqual(["sw"]);
  });
});
