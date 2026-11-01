import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductsView } from "@/client/app-shell/views/ProductsView";
import { ProductFormModal } from "@/client/app-shell/views/ProductFormModal";

describe("ProductsView Client Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with page title, add button, and products data-testid", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain('data-testid="page-products"');
    expect(html).toContain("المنتجات");
    expect(html).toContain('data-testid="add-product-btn"');
    expect(html).toContain("إضافة منتج");
  });

  it("renders segmented tabs for Store Products and Egyptian Catalog", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("منتجات المحل");
    expect(html).toContain("الكتالوج المصري");
  });

  it("renders summary statistics counters bar with total, low stock, and out of stock", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("إجمالي الأصناف");
    expect(html).toContain("قرب يخلص");
    expect(html).toContain("خلصان");
  });

  it("renders search box with Arabic placeholder", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("دوّر على منتج… اكتب أو اتكلم");
  });

  it("renders filter chips for stock status (all, low stock, out of stock)", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("الكل (0)");
    expect(html).toContain("قرب يخلص (0)");
    expect(html).toContain("خلصان (0)");
  });
});

describe("ProductFormModal Component", () => {
  it("renders creation modal with name, unit selection, and sell price inputs", () => {
    const html = renderToStaticMarkup(
      <ProductFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toContain("إضافة منتج");
    expect(html).toContain("اسم المنتج");
    expect(html).toContain("بيتباع إزاي؟");
    expect(html).toContain("بالقطعة / الكرتونة");
    expect(html).toContain("بالوزن (كيلو)");
    expect(html).toContain("بيع القطعة (ج.م)");
    expect(html).toContain("بيتباع كرتونة كمان");
    expect(html).toContain("إضافة للمحل");
  });

  it("renders edit modal with existing product data, read-only stock notice, and delete button", () => {
    const sampleProduct = {
      id: "prod-1",
      name_ar: "بيبسي 330 مل",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1000,
      buy_cost_piasters: 800,
      stock_quantity: 24,
      is_custom: true,
      variants: [
        {
          id: "var-1",
          pack_qty: 1,
          sell_price_piasters: 1000,
          buy_cost_piasters: 800,
          stock_quantity: 24,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={sampleProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain("تعديل المنتج");
    expect(html).toContain("بيبسي 330 مل");
    expect(html).toContain("المخزون الحالي:");
    expect(html).toContain("24 قطعة");
    expect(html).toContain("حذف");
    expect(html).toContain("حفظ التعديلات");
  });
});
