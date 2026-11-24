import { describe, expect, it } from "vitest";
import {
  buildReportCsv,
  buildReportText,
  reportFileName,
  scopeText,
  type ReportCount,
} from "@/client/features/stocktake/stocktake-report";

const count: ReportCount = {
  id: "c1",
  scope: "category",
  category: "بقالة",
  status: "confirmed",
  startedAt: "2026-11-24T08:00:00Z",
  confirmedAt: "2026-11-24T10:00:00Z",
  startedBy: "أحمد",
  closedBy: "أحمد",
  totals: {
    lines: 3,
    counted: 3,
    matched: 1,
    discrepancies: 2,
    shortageCostPiasters: 1800,
    surplusCostPiasters: 600,
    damagedBase: 3,
    lostBase: 0,
    unrecordedSaleBase: 0,
    unknownBase: 0,
  },
  lines: [
    {
      productName: "سكر",
      category: "بقالة",
      unit: "piece",
      expectedBase: 20,
      countedBase: 17,
      differenceBase: -3,
      reason: "damaged",
      differenceCostPiasters: 1800,
      appliedCostPiasters: 1800,
    },
    {
      productName: "رز, سايب",
      category: "بقالة",
      unit: "kg",
      expectedBase: 5000,
      countedBase: 6000,
      differenceBase: 1000,
      reason: "surplus",
      differenceCostPiasters: 600,
    },
    {
      productName: "زيت",
      category: "بقالة",
      unit: "piece",
      expectedBase: 4,
      countedBase: 4,
      differenceBase: 0,
      reason: null,
      differenceCostPiasters: 0,
    },
  ],
};

describe("stocktake report (download / share)", () => {
  it("the text says the scope, who, the differences with their reasons, and that it was applied once", () => {
    const text = buildReportText(count);
    expect(scopeText(count)).toBe("قسم «بقالة»");
    expect(text).toContain("تقرير جرد — قسم «بقالة»");
    expect(text).toContain("طبّقه: أحمد");
    expect(text).toContain("المتوقع 20 · الموجود 17 · الفرق −3 (تالف)");
    expect(text).toContain("الفرق +1 كيلو (زيادة)");
    expect(text).not.toContain("زيت:"); // a matching line is not a difference
    expect(text).toContain("اتطبقت على المخزون مرة واحدة");
  });

  it("the CSV has a BOM, a header, one row per product, and quotes values with commas", () => {
    const csv = buildReportCsv(count);
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = csv.trim().split("\r\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain("المنتج,القسم,المتوقع,الموجود,الفرق,السبب");
    expect(rows[1]).toBe("سكر,بقالة,20,17,-3,تالف,,18.00,18.00");
    expect(rows[2]!.startsWith('"رز, سايب"')).toBe(true);
    expect(reportFileName(count, "csv")).toBe("جرد-2026-11-24.csv");
  });

  it("a cancelled count says nothing changed", () => {
    expect(
      buildReportText({ ...count, status: "abandoned", confirmedAt: null }),
    ).toContain("المخزون ما اتغيرش");
  });
});
