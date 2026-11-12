import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  scaledSize,
  MAX_SIDE,
  hasSceneChanged,
} from "@/client/features/sales/scan-images";
import { ProductScannerSheet } from "@/client/features/sales/ProductScannerSheet";

describe("scanner photo preparation", () => {
  it("scales the long side down to the limit and keeps the aspect ratio", () => {
    expect(scaledSize(4000, 3000)).toEqual({ w: MAX_SIDE, h: 960 });
    expect(scaledSize(3000, 4000)).toEqual({ w: 960, h: MAX_SIDE });
    expect(scaledSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});

describe("ProductScannerSheet", () => {
  it("renders mode selection on initial open", () => {
    const html = renderToString(
      <ProductScannerSheet
        catalog={[]}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain('data-testid="scan-mode-select"');
    expect(html).toContain('data-testid="scan-mode-cash"');
    expect(html).toContain('data-testid="scan-mode-credit"');
    expect(html).toContain("اختر نوع البيع");
    expect(html).toContain("من غير أسعار ولا بيانات محلك");
  });

  it("disables credit mode when no customer is set", () => {
    const html = renderToString(
      <ProductScannerSheet
        catalog={[]}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain('data-testid="scan-mode-credit"');
    expect(html).not.toContain('data-testid="scan-mode-customer"');
  });

  it("shows customer name when creditCustomerName is provided", () => {
    const html = renderToString(
      <ProductScannerSheet
        catalog={[]}
        creditCustomerName="أحمد"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("أحمد");
  });
});

describe("hasSceneChanged", () => {
  it("returns false when video is not ready", () => {
    const video = { readyState: 1 } as HTMLVideoElement;
    const ref = { current: null };
    expect(hasSceneChanged(video, ref)).toBe(false);
  });
});
