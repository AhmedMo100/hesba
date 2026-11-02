import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StockView,
  type StockInventoryItem,
} from "@/client/app-shell/views/StockView";
import { AddStockModal } from "@/client/app-shell/views/AddStockModal";
import { AdjustStockModal } from "@/client/app-shell/views/AdjustStockModal";
import { ClearStockModal } from "@/client/app-shell/views/ClearStockModal";

describe("StockView Component (Phase 2 Inventory UI)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders header with 'المخزون' title, subtitle, and '+ إضافة' button matching Image 4", () => {
    const html = renderToStaticMarkup(<StockView />);
    expect(html).toContain('data-testid="page-stock"');
    expect(html).toContain("المخزون");
    expect(html).toContain("الكميات الحالية وسجل اللي دخل");
    expect(html).toContain('data-testid="add-stock-btn"');
    expect(html).toContain("إضافة");
  });

  it("renders segmented control tabs with 'الكميات' and 'سجل الإضافات'", () => {
    const html = renderToStaticMarkup(<StockView />);
    expect(html).toContain("الكميات");
    expect(html).toContain("سجل الإضافات");
  });

  it("renders search box and filter chips ('الكل', 'قرب يخلص', 'خلصان') on Tab 1", () => {
    const html = renderToStaticMarkup(<StockView />);
    expect(html).toContain("دوّر في المخزون");
    expect(html).toContain("الكل");
    expect(html).toContain("قرب يخلص (0)");
    expect(html).toContain("خلصان (0)");
  });
});

describe("AddStockModal Component (Phase 2 Modal Enhancements)", () => {
  it("renders dropdown selector trigger with search icon and arrow when no preset product is passed", () => {
    const html = renderToStaticMarkup(
      <AddStockModal
        options={[
          {
            variantId: "var-1",
            productId: "prod-1",
            productName: "شيبسي",
            unitMode: "piece",
            packQty: 12,
            currentStockBase: 56, // 4 كرتونة و 8 قطعة
          },
          {
            variantId: "var-2",
            productId: "prod-2",
            productName: "شوكولاتة",
            unitMode: "piece",
            packQty: 24,
            currentStockBase: 60, // 2 كرتونة و 12 قطعة
          },
        ]}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("إضافة للمخزون");
    expect(html).toContain("المنتج");
    expect(html).toContain("نوع الكمية التي يتم إدخالها:");
    expect(html).toContain("بالقطعة / الكرتونة");
    expect(html).toContain("بالوزن");
  });

  it("renders price comparison hint and expiry management options", () => {
    const html = renderToStaticMarkup(
      <AddStockModal
        targetProduct={{
          id: "prod-cola",
          name_ar: "كوكاكولا 1 لتر",
          category: "مشروبات",
          unit: "piece",
          sell_price_piasters: 1500,
          buy_cost_piasters: 1200,
          is_custom: false,
          variants: [
            {
              id: "var-cola",
              pack_qty: 12,
              sell_price_piasters: 1500,
              buy_cost_piasters: 1200,
            },
          ],
        }}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("إضافة للمخزون: كوكاكولا 1 لتر");
    expect(html).toContain("إجمالي سعر الشراء للكمية دي (ج.م)");
    expect(html).toContain("المنتج ملوش تاريخ صلاحية (زي المنظفات والورقيات)");
    expect(html).toContain("بعد شهر");
    expect(html).toContain("بعد 3 شهور");
    expect(html).toContain("بعد 6 شهور");
    expect(html).toContain("بعد سنة");
    expect(html).toContain("تأكيد الإضافة للمخزون ✓");
  });

  it("renders auto-calculated expected cost hint based on registered buy price", () => {
    const html = renderToStaticMarkup(
      <AddStockModal
        targetProduct={{
          id: "prod-pepsi",
          name_ar: "بيبسي تفاح",
          category: "مشروبات",
          unit: "piece",
          sell_price_piasters: 2000,
          buy_cost_piasters: 1500, // 15 EGP per piece -> 180 EGP per carton (12 pack)
          is_custom: false,
          variants: [
            {
              id: "var-pepsi",
              pack_qty: 12,
              sell_price_piasters: 2000,
              buy_cost_piasters: 1500,
            },
          ],
        }}
        onClose={() => {}}
        onAdded={() => {}}
      />,
    );

    expect(html).toContain("تكلفة تقديرية محسوبة");
  });
});

describe("AdjustStockModal & ClearStockModal Components (Stock Mutations UI)", () => {
  const mockItem: StockInventoryItem = {
    variantId: "var-100",
    productId: "prod-100",
    productName: "جبنة بيضاء دومتي",
    flavor: "فيتا",
    unitMode: "piece",
    packQty: 12,
    sellPricePiasters: 2500,
    buyPricePiasters: 2000,
    currentStockBase: 28, // 2 cartons + 4 pieces
    status: "ok",
    hasNearExpiry: false,
    batches: [],
  };

  it("renders AdjustStockModal with current balance, mode tabs, and difference indicator", () => {
    const html = renderToStaticMarkup(
      <AdjustStockModal
        item={mockItem}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain("تعديل الكمية (جرد وتسوية)");
    expect(html).toContain("جبنة بيضاء دومتي (فيتا)");
    expect(html).toContain("الرصيد الحالي");
    expect(html).toContain("2 كرتونة و 4 قطعة");
    expect(html).toContain("تعيين الرصيد الفعلي (جرد)");
    expect(html).toContain("إضافة أو خصم كمية (+ / -)");
    expect(html).toContain("سبب التعديل");
    expect(html).toContain("فرق التسوية:");
  });

  it("renders ClearStockModal with warning, details and checkbox to hide from active view", () => {
    const html = renderToStaticMarkup(
      <ClearStockModal
        item={mockItem}
        onClose={() => {}}
        onCleared={() => {}}
      />,
    );

    expect(html).toContain("إزالة وتصفير المخزون");
    expect(html).toContain("تنبيه هام قبل تصفير المخزون");
    expect(html).toContain("جبنة بيضاء دومتي (فيتا)");
    expect(html).toContain("إخفاء الصنف من شاشة المخزون الحالية");
    expect(html).toContain("تأكيد الإزالة والتصفير");
  });
});
