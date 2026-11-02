import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductsView } from "@/client/app-shell/views/ProductsView";
import { ProductFormModal } from "@/client/app-shell/views/ProductFormModal";
import { AddStockModal } from "@/client/app-shell/views/AddStockModal";

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

  it("renders search box with Arabic placeholder and microphone button", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("دوّر على منتج… اكتب أو اتكلم");
    expect(html).toContain("بحث بالصوت");
  });

  it("renders filter chips for all products and toggle button for hidden products", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).toContain("الكل (0)");
    expect(html).toContain("المخفية (0)");
  });

  it("strictly omits stock balance, stock quantities, and stock badges from products view", () => {
    const html = renderToStaticMarkup(<ProductsView />);
    expect(html).not.toContain("متاح ");
    expect(html).not.toContain("المخزون الحالي");
    expect(html).not.toContain("قرب يخلص");
    expect(html).not.toContain("خلصان");
  });
});

describe("ProductFormModal Component", () => {
  it("renders creation modal with name, packaging selection, and piece pricing matching demo", () => {
    const html = renderToStaticMarkup(
      <ProductFormModal onClose={() => {}} onSaved={() => {}} />,
    );
    expect(html).toContain("إضافة منتج");
    expect(html).toContain("اسم المنتج");
    expect(html).toContain("بيتباع إزاي؟");
    expect(html).toContain("بالقطعة / الكرتونة");
    expect(html).toContain("بالوزن");
    expect(html).toContain("بيتباع كرتونة كمان");
    expect(html).toContain("سعر القطعة");
    expect(html).toContain("إضافة");
    expect(html).toContain("إلغاء");
  });

  it("renders weight pricing options (kilo and gram) when weighed product is passed", () => {
    const sampleWeighedProduct = {
      id: "prod-weight",
      name_ar: "جبنة رومي قديمة",
      category: "ألبان وجبن",
      unit: "kg",
      sell_price_piasters: 24000,
      buy_cost_piasters: 20000,
      variants: [
        {
          id: "var-w",
          pack_qty: 1,
          sell_price_piasters: 24000,
          buy_cost_piasters: 20000,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={sampleWeighedProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain("التسعير بالوزن:");
    expect(html).toContain("بالكيلو (كجم)");
    expect(html).toContain("بالجرام (جم)");
    expect(html).toContain("سعر الكيلو");
  });

  it("renders carton fields and pricing when packaged product is passed", () => {
    const samplePackagedProduct = {
      id: "prod-pkg",
      name_ar: "Pepsi 1L",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1500,
      buy_cost_piasters: 1350,
      variants: [
        {
          id: "var-1",
          pack_qty: 12,
          sell_price_piasters: 1500,
          buy_cost_piasters: 1350,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={samplePackagedProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(html).toContain("عدد القطع في الكرتونة");
    expect(html).toContain("سعر الكرتونة");
    expect(html).toContain("سعر القطعة");
  });

  it("renders edit modal with existing product data and delete button, with NO stock inputs", () => {
    const sampleProduct = {
      id: "prod-1",
      name_ar: "بيبسي 330 مل",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1000,
      buy_cost_piasters: 800,
      is_custom: true,
      variants: [
        {
          id: "var-1",
          pack_qty: 1,
          sell_price_piasters: 1000,
          buy_cost_piasters: 800,
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
    expect(html).toContain("حذف");
    expect(html).toContain("حفظ");
    expect(html).not.toContain("المخزون الحالي:");
  });

  it("renders service commission input when service category is edited (e.g. internet bills, money transfer)", () => {
    const serviceProduct = {
      id: "prod-bill",
      name_ar: "دفع فاتورة إنترنت منزلي وي",
      category: "فواتير إنترنت",
      unit: "piece",
      sell_price_piasters: 500,
      variants: [
        {
          id: "var-bill",
          pack_qty: 1,
          sell_price_piasters: 500,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={serviceProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("عمولة الخدمة للمحل");
    expect(html).toContain("قيمة العمولة (ج.م)");
    expect(html).not.toContain("بيتباع إزاي؟");
  });

  it("renders scratch card title 'سعر الكارت' when prepaid card category is edited", () => {
    const cardProduct = {
      id: "prod-card",
      name_ar: "كارت شحن فودافون فكة 10",
      category: "كروت شحن",
      unit: "piece",
      sell_price_piasters: 1100,
      buy_cost_piasters: 1050,
      variants: [
        {
          id: "var-card",
          pack_qty: 1,
          sell_price_piasters: 1100,
          buy_cost_piasters: 1050,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <ProductFormModal
        product={cardProduct}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("سعر الكارت");
  });
});

describe("AddStockModal Component", () => {
  it("renders quantity mode choice (carton/piece vs weight) and total purchase cost input", () => {
    const sampleProduct = {
      id: "prod-sample",
      name_ar: "بيبسي 1 لتر",
      category: "مشروبات",
      unit: "piece",
      sell_price_piasters: 1500,
      buy_cost_piasters: 1350,
      is_custom: false,
      variants: [
        {
          id: "var-p1",
          pack_qty: 12,
          sell_price_piasters: 1500,
          buy_cost_piasters: 1350,
        },
      ],
    };

    const html = renderToStaticMarkup(
      <AddStockModal
        targetProduct={sampleProduct}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("إضافة للمخزون: بيبسي 1 لتر");
    expect(html).toContain("نوع الكمية التي يتم إدخالها:");
    expect(html).toContain("بالقطعة / الكرتونة");
    expect(html).toContain("بالوزن");
    expect(html).toContain("كراتين");
    expect(html).toContain("قطع زيادة");
    expect(html).toContain("قطع/كرتونة");
    expect(html).toContain("إجمالي سعر الشراء للكمية دي (ج.م)");
    expect(html).toContain("تاريخ الإنتاج / البداية (اختياري)");
    expect(html).toContain("تاريخ الانتهاء");
    expect(html).toContain("المنتج ملوش تاريخ صلاحية (زي المنظفات والورقيات)");
    expect(html).toContain("بعد 3 شهور");
    expect(html).toContain("بعد سنة");
  });
});
