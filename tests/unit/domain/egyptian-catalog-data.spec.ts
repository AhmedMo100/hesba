import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCatalogFile } from "../../../scripts/import-catalog";

describe("Egyptian Market Catalog Dataset Verification (Phase 3.1)", () => {
  const datasetDir = path.resolve(
    process.cwd(),
    "data/catalog/egyptian-market",
  );

  it("ensures all CSV files exist in data/catalog/egyptian-market", () => {
    expect(fs.existsSync(path.join(datasetDir, "brands.csv"))).toBe(true);
    expect(fs.existsSync(path.join(datasetDir, "products.csv"))).toBe(true);
    expect(fs.existsSync(path.join(datasetDir, "variants.csv"))).toBe(true);
    expect(fs.existsSync(path.join(datasetDir, "README.md"))).toBe(true);
  });

  it("validates brands.csv has 0 errors and 0 duplicates", () => {
    const content = fs.readFileSync(
      path.join(datasetDir, "brands.csv"),
      "utf-8",
    );
    const { report, validDataRows } = validateCatalogFile(
      "brands.csv",
      content,
    );

    expect(report.errors).toHaveLength(0);
    expect(report.duplicates).toHaveLength(0);
    expect(validDataRows.length).toBeGreaterThan(50);
  });

  it("validates products.csv has 0 errors and 0 duplicates and covers all 15 categories", () => {
    const content = fs.readFileSync(
      path.join(datasetDir, "products.csv"),
      "utf-8",
    );
    const { report, validDataRows } = validateCatalogFile(
      "products.csv",
      content,
    );

    expect(report.errors).toHaveLength(0);
    expect(report.duplicates).toHaveLength(0);
    expect(validDataRows.length).toBeGreaterThan(100);

    const categories = new Set(validDataRows.map((r) => r["category"]));
    expect(categories.has("الأرز والمكرونة والحبوب والبقوليات")).toBe(true);
    expect(categories.has("الدقيق والسكر والملح")).toBe(true);
    expect(categories.has("الزيوت والسمن والخل")).toBe(true);
    expect(categories.has("الشاي والقهوة والمشروبات الساخنة")).toBe(true);
    expect(categories.has("الألبان والجبن والزبادي")).toBe(true);
    expect(categories.has("العصائر والمياه والمشروبات الغازية")).toBe(true);
    expect(categories.has("البسكويت والويفر والكيك والشوكولاتة")).toBe(true);
    expect(categories.has("الشيبسي والمقرمشات والتسالي")).toBe(true);
    expect(categories.has("الصلصات والكاتشب والتوابل")).toBe(true);
    expect(categories.has("المعلبات والتونة والفول")).toBe(true);
    expect(categories.has("المجمدات")).toBe(true);
    expect(categories.has("المنظفات ومساحيق الغسيل وسوائل الأطباق")).toBe(true);
    expect(categories.has("الصابون والشامبو ومعجون الأسنان")).toBe(true);
    expect(categories.has("المناديل وورق التواليت والأكياس")).toBe(true);
    expect(categories.has("منتجات الأطفال الأساسية")).toBe(true);
  });

  it("validates variants.csv has 0 errors and 0 duplicates", () => {
    const content = fs.readFileSync(
      path.join(datasetDir, "variants.csv"),
      "utf-8",
    );
    const { report, validDataRows } = validateCatalogFile(
      "variants.csv",
      content,
    );

    expect(report.errors).toHaveLength(0);
    expect(report.duplicates).toHaveLength(0);
    expect(validDataRows.length).toBeGreaterThan(200);
  });

  it("enforces relational integrity: every product and variant has a valid parent brand and product", () => {
    const brandsCsv = fs.readFileSync(
      path.join(datasetDir, "brands.csv"),
      "utf-8",
    );
    const productsCsv = fs.readFileSync(
      path.join(datasetDir, "products.csv"),
      "utf-8",
    );
    const variantsCsv = fs.readFileSync(
      path.join(datasetDir, "variants.csv"),
      "utf-8",
    );

    const { validDataRows: brandRows } = validateCatalogFile(
      "brands.csv",
      brandsCsv,
    );
    const { validDataRows: productRows } = validateCatalogFile(
      "products.csv",
      productsCsv,
    );
    const { validDataRows: variantRows } = validateCatalogFile(
      "variants.csv",
      variantsCsv,
    );

    const brandNames = new Set(brandRows.map((b) => b["name_ar"]));
    const productNames = new Set(productRows.map((p) => p["product_name_ar"]));

    for (const prod of productRows) {
      expect(brandNames.has(prod["brand_name_ar"]!)).toBe(true);
    }

    for (const variant of variantRows) {
      expect(productNames.has(variant["product_name_ar"]!)).toBe(true);
      expect(brandNames.has(variant["brand_name_ar"]!)).toBe(true);
    }
  });

  it("enforces NO barcode and NO price columns exist in dataset or templates", () => {
    const files = [
      path.join(datasetDir, "brands.csv"),
      path.join(datasetDir, "products.csv"),
      path.join(datasetDir, "variants.csv"),
      path.resolve(process.cwd(), "data/catalog/templates/variants.csv"),
    ];

    for (const file of files) {
      const firstLine = fs.readFileSync(file, "utf-8").split("\n")[0] ?? "";
      expect(firstLine.toLowerCase()).not.toContain("barcode");
      expect(firstLine.toLowerCase()).not.toContain("sell_price");
      expect(firstLine.toLowerCase()).not.toContain("cost");
    }
  });
});
