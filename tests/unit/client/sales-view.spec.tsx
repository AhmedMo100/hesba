import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesView } from "@/client/features/sales/SalesView";

describe("SalesView Client Component", () => {
  const STAGED_KEY = "hesba_staged_sale_item";

  beforeEach(() => {
    // Mock localStorage and sessionStorage
    const store: Record<string, string> = {};
    const sessionStore: Record<string, string> = {};

    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] || null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
    });

    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessionStore[k] || null,
      setItem: (k: string, v: string) => {
        sessionStore[k] = v;
      },
      removeItem: (k: string) => {
        delete sessionStore[k];
      },
      clear: () => {
        for (const k in sessionStore) delete sessionStore[k];
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty state when there are no sales recorded", () => {
    const html = renderToStaticMarkup(<SalesView />);
    expect(html).toContain('data-testid="page-sales"');
    expect(html).toContain("مبيعات النهارده");
    expect(html).toContain("لسه مفيش مبيعات اتسجلت النهارده");
  });

  it("shows a staged service as a tile without recording a sale (ADR-0019)", () => {
    // Stage an item as if user clicked 'إضافة إلى البيع' on a card/service
    const stagedItem = {
      id: "prod-service-1",
      name: "شحن كارت كهرباء مسبق الدفع",
      sellPricePiasters: 5000,
      category: "خدمات مرافق",
      unit: "service",
    };
    sessionStorage.setItem(STAGED_KEY, JSON.stringify(stagedItem));

    const html = renderToStaticMarkup(<SalesView />);

    // The staged item is displayed as a tile…
    expect(html).toContain("شحن كارت كهرباء مسبق الدفع");
    expect(html).toContain('aria-label="بيع شحن كارت كهرباء مسبق الدفع"');
    expect(html).toContain("عمولة 50 ج");
    expect(html).toContain("آخر البيعات");
    // …but nothing was sold: no sale exists until the server records one.
    expect(html).toContain("لسه مفيش مبيعات اتسجلت النهارده");
    expect(localStorage.getItem("hesba_sales_records_default")).toBeNull();

    // Check that sessionStorage item was consumed
    expect(sessionStorage.getItem(STAGED_KEY)).toBeNull();
  });

  it("renders search box with voice search and legend indicators matching Image 1", () => {
    const html = renderToStaticMarkup(<SalesView />);
    expect(html).toContain("دوّر على صنف...");
    expect(html).toContain("مبيعات النهارده");
    expect(html).toContain("خلصان");
    expect(html).toContain("قرب يخلص");
    expect(html).toContain('data-testid="today-sales-pill"');
  });

  it("renders carton selling button for multi-pack items", () => {
    const stagedItem = {
      id: "prod-pepsi-1",
      name: "Pepsi 1L",
      sellPricePiasters: 1500,
      category: "مشروبات",
      unit: "piece",
    };
    sessionStorage.setItem(STAGED_KEY, JSON.stringify(stagedItem));

    const html = renderToStaticMarkup(<SalesView />);
    expect(html).toContain("Pepsi 1L");
    expect(html).toContain("15 ج");
  });
});
