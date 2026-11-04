import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SalesView } from "@/client/app-shell/views/SalesView";

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

  it("ingests staged sale item from sessionStorage and records it into sales list", () => {
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

    // Check that the staged item is displayed
    expect(html).toContain("شحن كارت كهرباء مسبق الدفع");
    expect(html).toContain("50 ج.م");
    expect(html).toContain("آخر المبيعات المسجلة");
    expect(html).toContain(
      "تم تسجيل عملية البيع: شحن كارت كهرباء مسبق الدفع بنجاح ✓",
    );

    // Check that sessionStorage item was consumed
    expect(sessionStorage.getItem(STAGED_KEY)).toBeNull();
  });
});
