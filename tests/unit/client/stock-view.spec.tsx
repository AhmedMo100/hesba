import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  StockView,
  type StockInventoryItem,
} from "@/client/app-shell/views/StockView";
import { AddStockModal } from "@/client/app-shell/views/AddStockModal";
import { ClearStockModal } from "@/client/app-shell/views/ClearStockModal";
import { ArchiveStockModal } from "@/client/app-shell/views/ArchiveStockModal";

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

  it("renders segmented control tabs with 'الكميات' and 'سجل الحركات'", () => {
    const html = renderToStaticMarkup(<StockView />);
    expect(html).toContain("الكميات");
    expect(html).toContain("سجل الحركات");
  });

  it("renders search box, stock type filters, and status filter chips on Tab 1", () => {
    const html = renderToStaticMarkup(<StockView />);
    expect(html).toContain("دوّر في المخزون");
    expect(html).toContain("كافة الأنواع");
    expect(html).toContain("منتجات مادية");
    expect(html).toContain("كروت فيزيائية");
    expect(html).toContain("وحدات رقمية");
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
    expect(html).toContain(
      "المنتج ملوش تاريخ صلاحية (زي الكروت، المنظفات، والورقيات)",
    );
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

    expect(html).toContain("السعر المتوقع بناءً على سعر الشراء المسجل");
  });
});

describe("ClearStockModal & ArchiveStockModal Components (Separated Zeroing & Archiving)", () => {
  const mockItemWithStock: StockInventoryItem = {
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

  const mockItemZeroStock: StockInventoryItem = {
    ...mockItemWithStock,
    currentStockBase: 0,
    status: "out",
  };

  it("renders ClearStockModal as pure zeroing dialog with warning and confirmation button", () => {
    const html = renderToStaticMarkup(
      <ClearStockModal
        item={mockItemWithStock}
        onClose={() => {}}
        onCleared={() => {}}
      />,
    );

    expect(html).toContain("تصفير المخزون");
    expect(html).toContain("تنبيه هام قبل تصفير المخزون");
    expect(html).toContain("جبنة بيضاء دومتي (فيتا)");
    expect(html).toContain("2 كرتونة و 4 قطعة");
    expect(html).toContain("تأكيد تصفير المخزون");
    expect(html).toContain("سبب تصفير المخزون");
  });

  it("renders ArchiveStockModal with blocker when current balance is positive (> 0)", () => {
    const html = renderToStaticMarkup(
      <ArchiveStockModal
        item={mockItemWithStock}
        onClose={() => {}}
        onArchived={() => {}}
        onOpenClearStock={() => {}}
      />,
    );

    expect(html).toContain("إزالة الصنف من قائمة المخزون");
    expect(html).toContain("لا يمكن إزالة الصنف لأن رصيده موجب");
    expect(html).toContain("تصفير المخزون أولاً");
    expect(html).not.toContain("تأكيد الإزالة من المخزون");
  });

  it("renders ArchiveStockModal with confirm action when current balance is zero (=== 0)", () => {
    const html = renderToStaticMarkup(
      <ArchiveStockModal
        item={mockItemZeroStock}
        onClose={() => {}}
        onArchived={() => {}}
      />,
    );

    expect(html).toContain("إزالة الصنف من قائمة المخزون");
    expect(html).toContain("إخفاء من قائمة المخزون اليومية");
    expect(html).toContain("تأكيد الإزالة من المخزون");
    expect(html).not.toContain("لا يمكن إزالة الصنف لأن رصيده موجب");
  });
});
