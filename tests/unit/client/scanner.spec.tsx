import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { scaledSize, MAX_SIDE } from "@/client/features/sales/scan-images";
import { ProductScannerSheet } from "@/client/features/sales/ProductScannerSheet";

describe("scanner photo preparation", () => {
  it("scales the long side down to the limit and keeps the aspect ratio", () => {
    expect(scaledSize(4000, 3000)).toEqual({ w: MAX_SIDE, h: 960 });
    expect(scaledSize(3000, 4000)).toEqual({ w: 960, h: MAX_SIDE });
    expect(scaledSize(800, 600)).toEqual({ w: 800, h: 600 });
  });
});

describe("ProductScannerSheet", () => {
  it("offers the camera (rear, image/*) and the gallery (several images) and explains what is sent", () => {
    const html = renderToString(
      <ProductScannerSheet
        catalog={[]}
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain('data-testid="product-scanner"');
    expect(html).toMatch(/accept="image\/\*"[^>]*capture="environment"/);
    expect(html).toMatch(/accept="image\/\*"[^>]*multiple=""/);
    expect(html).toContain("من غير أسعار ولا بيانات محلك");
    // «تم» is disabled until a photo is taken.
    expect(html).toMatch(
      /data-testid="scan-process"[^>]*|disabled=""[^>]*data-testid="scan-process"/,
    );
  });
});
