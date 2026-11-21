import { ToastProvider } from "@/client/shared/ui";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StockView } from "@/client/features/stock/StockView";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { ArchiveStockModal } from "@/client/features/stock/ArchiveStockModal";
import { MachineTopupModal } from "@/client/features/stock/MachineTopupModal";

describe("StockView — Stock Entry Wizard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders landing step with barcode and manual entry choices", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <StockView />
      </ToastProvider>,
    );
    expect(html).toContain('data-testid="page-stock"');
    expect(html).toContain("دخلت بضاعة جديدة؟");
    expect(html).toContain("امسح الباركود");
    expect(html).toContain("تسجيل يدوي");
    expect(html).toContain('data-testid="stock-scan-btn"');
    expect(html).toContain('data-testid="stock-manual-btn"');
  });

  it("includes camera and manual entry icons", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <StockView />
      </ToastProvider>,
    );
    expect(html).toContain("📷");
    expect(html).toContain("✍️");
  });
});

describe("ArchiveStockModal (zeroing a product was removed: the quantity is edited)", () => {
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

  it("renders ArchiveStockModal with blocker when current balance is positive (> 0)", () => {
    const html = renderToStaticMarkup(
      <ArchiveStockModal
        item={mockItemWithStock}
        onClose={() => {}}
        onArchived={() => {}}
        onOpenEditQuantity={() => {}}
      />,
    );

    expect(html).toContain("إزالة الصنف من قائمة المخزون");
    expect(html).toContain("لا يمكن إزالة الصنف لأن رصيده موجب");
    expect(html).toContain("سجّل الباقي تالف / فاقد");
    expect(html).not.toContain("تصفير");
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

describe("MachineTopupModal Component (POS Machine Top-up Dialog)", () => {
  it("renders machine balance top-up sheet with current balance and source of funds", () => {
    const mockMachine = {
      id: "mach-test",
      name: "ماكينة فوري الكاشير",
      provider: "فوري (Fawry)",
      terminalId: "POS-9988",
      status: "active" as const,
      currentBalancePiasters: 150000,
      balanceTransactions: [],
      createdAt: new Date().toISOString(),
    };

    const html = renderToStaticMarkup(
      <MachineTopupModal
        machine={mockMachine}
        onClose={() => {}}
        onSuccess={() => {}}
      />,
    );

    expect(html).toContain("إضافة رصيد: ماكينة فوري الكاشير");
    expect(html).toContain("الرصيد المتاح الحالي");
    expect(html).toContain("1,500 ج.م");
    expect(html).toContain("مبلغ الشحن / الإيداع المطلوب إضافته");
    expect(html).toContain("مصدر الرصيد (من أين تم دفع المبلغ)");
    expect(html).toContain("خزينة المحل (كاش نقدي)");
    expect(html).toContain("تأكيد إضافة الرصيد ✓");
  });
});
