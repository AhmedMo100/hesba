import { describe, expect, it } from "vitest";
import {
  matchesSaleFilter,
  saleSortRank,
  type DisplaySaleItem,
} from "@/client/features/sales/sales.logic";

const item = (over: Partial<DisplaySaleItem>): DisplaySaleItem => ({
  id: over.name ?? "x",
  productId: over.name ?? "x",
  name: "x",
  sellPricePiasters: 100,
  unitMode: "piece",
  packQty: 1,
  currentStockBase: 10,
  status: "ok",
  ...over,
});

describe("sale tiles: V19 filters and order", () => {
  const noBarcode = item({ name: "عيش" });
  const weighed = item({ name: "جبنة", unitMode: "weight" });
  const withBarcode = item({ name: "كولا", hasBarcode: true });
  const service = item({ name: "شحن", unitMode: "service", isService: true });

  it("puts products without a barcode first, then weighed, then the rest", () => {
    const sorted = [service, withBarcode, weighed, noBarcode].sort(
      (a, b) => saleSortRank(a) - saleSortRank(b),
    );
    expect(sorted.map((i) => i.name).slice(0, 2)).toEqual(["عيش", "جبنة"]);
  });

  it("filters by weight, no barcode and services", () => {
    const all = [noBarcode, weighed, withBarcode, service];
    const names = (f: Parameters<typeof matchesSaleFilter>[1]) =>
      all.filter((i) => matchesSaleFilter(i, f)).map((i) => i.name);
    expect(names("all")).toHaveLength(4);
    expect(names("weight")).toEqual(["جبنة"]);
    expect(names("nobc")).toEqual(["عيش", "جبنة"]);
    expect(names("svc")).toEqual(["شحن"]);
  });
});
