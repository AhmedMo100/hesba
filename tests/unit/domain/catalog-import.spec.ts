import { describe, expect, it } from "vitest";
import { validateCatalogFile } from "../../../scripts/import-catalog";

describe("Catalog Import Tooling & Validation", () => {
  it("rejects file with missing required headers", () => {
    const csv = `product_name,category\nشاي العروسة,مشروبات`;
    const { report } = validateCatalogFile("products.csv", csv);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]!.message).toContain(
      "Missing required header columns",
    );
  });

  it("skips completely empty rows and rows with empty required fields", () => {
    const csv = `brand_name_ar,product_name_ar,category,type
جهينة,حليب كامل الدسم,ألبان,stock
,,,
جهينة,,ألبان,stock`;

    const { report, validDataRows } = validateCatalogFile("products.csv", csv);
    expect(report.totalRows).toBe(3);
    expect(report.validRows).toBe(1);
    expect(report.skippedRows.length).toBe(2);
    expect(report.skippedRows[0]!.reason).toContain("empty");
    expect(report.skippedRows[1]!.reason).toContain(
      "Empty value in required field(s)",
    );
    expect(validDataRows).toHaveLength(1);
  });

  it("validates size_value must be a positive number", () => {
    const csv = `product_name_ar,brand_name_ar,flavor,size_value,size_unit,pack_qty,barcode
شيبسي,شيبسي,ملح,-50,g,1,62210001
شيبسي,شيبسي,ملح,abc,g,1,62210002
شيبسي,شيبسي,ملح,0,g,1,62210003
شيبسي,شيبسي,ملح,50,g,1,62210004`;

    const { report, validDataRows } = validateCatalogFile("variants.csv", csv);
    expect(report.errors.length).toBe(3);
    expect(report.errors[0]!.message).toContain(
      "size_value must be a positive number",
    );
    expect(report.errors[1]!.message).toContain(
      "size_value must be a positive number",
    );
    expect(report.errors[2]!.message).toContain(
      "size_value must be a positive number",
    );
    expect(validDataRows).toHaveLength(1);
  });

  it("validates size_unit must be one of ['g', 'kg', 'ml', 'l', 'piece']", () => {
    const csv = `product_name_ar,brand_name_ar,flavor,size_value,size_unit,pack_qty,barcode
كوكاكولا,كوكاكولا,,250,can,1,62210001
كوكاكولا,كوكاكولا,,250,ml,1,62210002`;

    const { report, validDataRows } = validateCatalogFile("variants.csv", csv);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]!.message).toContain('Invalid size_unit "can"');
    expect(validDataRows).toHaveLength(1);
  });

  it("validates pack_qty must be a positive whole number", () => {
    const csv = `product_name_ar,brand_name_ar,flavor,size_value,size_unit,pack_qty,barcode
نيدو,نستله,,1,kg,0,62210001
نيدو,نستله,,1,kg,1.5,62210002
نيدو,نستله,,1,kg,-12,62210003
نيدو,نستله,,1,kg,12,62210004`;

    const { report, validDataRows } = validateCatalogFile("variants.csv", csv);
    expect(report.errors.length).toBe(3);
    expect(report.errors[0]!.message).toContain(
      "pack_qty must be a positive whole number",
    );
    expect(report.errors[1]!.message).toContain(
      "pack_qty must be a positive whole number",
    );
    expect(report.errors[2]!.message).toContain(
      "pack_qty must be a positive whole number",
    );
    expect(validDataRows).toHaveLength(1);
  });

  it("validates barcode must contain digits only", () => {
    const csv = `product_name_ar,brand_name_ar,flavor,size_value,size_unit,pack_qty,barcode
بيبسي,بيبسي,,330,ml,1,62210ABC001
بيبسي,بيبسي,,330,ml,1,62210000001`;

    const { report, validDataRows } = validateCatalogFile("variants.csv", csv);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]!.message).toContain(
      "barcode must contain digits only",
    );
    expect(validDataRows).toHaveLength(1);
  });

  it("reports duplicate barcodes with exact row numbers and NEVER merges", () => {
    const csv = `product_name_ar,brand_name_ar,flavor,size_value,size_unit,pack_qty,barcode
شيبسي جبنة,شيبسي,جبنة,50,g,1,6221000001
شيبسي طماطم,شيبسي,طماطم,50,g,1,6221000001
شيبسي شطة,شيبسي,شطة,50,g,1,6221000002`;

    const { report } = validateCatalogFile("variants.csv", csv);
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0]!.type).toBe("barcode");
    expect(report.duplicates[0]!.identifier).toBe("6221000001");
    expect(report.duplicates[0]!.rows).toEqual([2, 3]);

    const dupError = report.errors.find((e) =>
      e.message.includes("Duplicate barcode"),
    );
    expect(dupError).toBeDefined();
    expect(dupError?.message).toContain("NEVER merged");
  });

  it("validates transfer commissions rows and checks amount ordering", () => {
    const csv = `provider,from_amount_piasters,to_amount_piasters,fee_type,fee_value
vodafone,10000,5000,fixed,200
vodafone,1000,50000,custom,100
vodafone,1000,50000,fixed,200`;

    const { report, validDataRows } = validateCatalogFile(
      "transfer_commissions.csv",
      csv,
    );
    expect(report.errors.length).toBe(2);
    expect(report.errors[0]!.message).toContain(
      "to_amount_piasters must be an integer >= from_amount_piasters",
    );
    expect(report.errors[1]!.message).toContain(
      "fee_type must be 'fixed' or 'percent'",
    );
    expect(validDataRows).toHaveLength(1);
  });

  it("validates prepaid cards require positive integer piasters and optional validity_days", () => {
    const csv = `network,denomination_piasters,data_package_ar,validity_days,sell_price_piasters,cost_piasters
vodafone,1000,باقة إنترنت,invalid,1050,950
vodafone,1000,باقة إنترنت,28,1050,950`;

    const { report, validDataRows } = validateCatalogFile(
      "prepaid_cards.csv",
      csv,
    );
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]!.message).toContain(
      "validity_days must be a positive integer",
    );
    expect(validDataRows).toHaveLength(1);
  });

  it("validates bills requires valid bill_type enum", () => {
    const csv = `provider,bill_type,label_ar
we,invalid_type,فاتورة التليفون
we,landline,فاتورة التليفون الأرضي`;

    const { report, validDataRows } = validateCatalogFile("bills.csv", csv);
    expect(report.errors.length).toBe(1);
    expect(report.errors[0]!.message).toContain(
      'Invalid bill_type "invalid_type"',
    );
    expect(validDataRows).toHaveLength(1);
  });
});
