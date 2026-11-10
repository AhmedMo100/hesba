import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * QA-01 / QA-02 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0019) against a real server and database:
 *   A. Tap a product → success only after the server recorded it; the server has ONE sale
 *      and the stock went down once; after a reload the sale is still listed.
 *   B. Another device sold the last piece while this screen still shows stock → the tap is
 *      rejected (409): an error toast, no sale in the list, nothing deducted.
 *   C. Offline → the tap is refused with an error, nothing is recorded.
 *   D. Two fast taps with one piece left → exactly one sale, stock 0, never negative.
 *
 * Needs a server whose database is safe to write to (the test signs up a new store).
 */

const SERVER = { timeout: 20_000 };
const PAGE_LOAD = { timeout: 45_000 };

function randomPhone(): string {
  return `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

async function stockOf(api: APIRequestContext, variantId: string) {
  const body = await (await api.get("/api/stock")).json();
  return body.inventory.find(
    (i: { variantId: string }) => i.variantId === variantId,
  )?.currentStockBase as number;
}

async function salesOf(api: APIRequestContext, name: string) {
  const body = await (await api.get("/api/sales")).json();
  return (
    body.sales as Array<{
      name: string;
      amountPiasters: number;
      quantity: number;
    }>
  ).filter((s) => s.name === name);
}

test.describe("Atomic sale on the sales screen", () => {
  test("success, server rejection, offline, and a double tap on the last piece", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const runId = Math.random().toString(36).slice(2, 7);
    const api = page.request;
    const signup = await api.post("/api/auth/signup", {
      data: {
        ownerName: "صاحب محل بيع",
        phone: randomPhone(),
        email: `sale-e2e-${runId}@hesba.test`,
        password: "Sale-e2e-2026-ok",
        storeName: `محل بيع ${runId}`,
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
      },
    });
    expect(signup.ok()).toBe(true);

    const name = `عصير ${runId}`;
    const product = await api.post("/api/products", {
      data: {
        nameAr: name,
        category: "مشروبات",
        unit: "piece",
        sellPricePiasters: 1250,
        buyCostPiasters: 900,
        isCustom: true,
        variants: [
          { packQty: 1, sellPricePiasters: 1250, costPricePiasters: 900 },
        ],
      },
    });
    expect(product.ok()).toBe(true);
    const variantId: string = (await product.json()).data.variants[0].id;
    expect(
      (
        await api.post("/api/stock", {
          data: {
            action: "add",
            storeVariantId: variantId,
            quantityBase: 3,
            costPricePiasters: 2700,
          },
        })
      ).ok(),
    ).toBe(true);

    const salePosts: number[] = [];
    let stockPosts = 0;
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (r.request().method() !== "POST") return;
      if (u.pathname === "/api/sales") salePosts.push(r.status());
      if (u.pathname === "/api/stock") stockPosts += 1;
    });

    await page.goto("/app/sales");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    const tile = page.getByRole("button", { name: `بيع ${name}` });
    await expect(tile).toBeVisible(PAGE_LOAD);
    const recent = page.locator("[class*='recentList']");

    // ---- A. A normal sale --------------------------------------------------------------
    await tile.click();
    await expect(page.getByText(`تم تسجيل بيع: ${name}`)).toBeVisible(SERVER);
    expect(await stockOf(api, variantId)).toBe(2);
    expect(await salesOf(api, name)).toEqual([
      expect.objectContaining({ amountPiasters: 1250, quantity: 1 }),
    ]);
    expect(stockPosts).toBe(0); // the screen no longer deducts stock itself

    await page.reload();
    await expect(recent.getByText(name)).toHaveCount(1, PAGE_LOAD);

    // ---- B. Another device sells the rest while this screen still shows stock ---------
    await expect(tile).toBeVisible(PAGE_LOAD);
    const elsewhere = await api.post("/api/sales", {
      data: { variantId, quantityBase: 2, opId: crypto.randomUUID() },
    });
    expect(elsewhere.ok()).toBe(true);
    expect(await stockOf(api, variantId)).toBe(0);

    await tile.click();
    await expect(page.getByText("الكمية في المخزن مش كفاية")).toBeVisible(
      SERVER,
    );
    await expect(page.getByText(`تم تسجيل بيع: ${name}`)).toHaveCount(0);
    expect(salePosts.slice(-1)).toEqual([409]);
    expect(await stockOf(api, variantId)).toBe(0);
    expect(await salesOf(api, name)).toHaveLength(2); // A + the other device, no third
    await expect(recent.getByText(name)).toHaveCount(1); // the rejected tap added nothing

    // ---- C. Offline -------------------------------------------------------------------
    await api.post("/api/stock", {
      data: {
        action: "add",
        storeVariantId: variantId,
        quantityBase: 1,
        costPricePiasters: 900,
      },
    });
    await page.reload();
    await expect(tile).toBeVisible(PAGE_LOAD);
    const postsBeforeOffline = salePosts.length;
    await page.context().setOffline(true);
    await tile.click();
    await expect(page.getByText("البيع محتاج إنترنت")).toBeVisible(SERVER);
    await page.context().setOffline(false);
    expect(salePosts.length).toBe(postsBeforeOffline);
    expect(await stockOf(api, variantId)).toBe(1);
    expect(await salesOf(api, name)).toHaveLength(2);

    // ---- D. Two fast taps on the last piece -------------------------------------------
    await tile.click();
    await tile.click({ force: true });
    await expect
      .poll(() => salePosts.length, SERVER)
      .toBe(postsBeforeOffline + 2);
    expect(salePosts.slice(-2).sort()).toEqual([200, 409]);
    expect(await stockOf(api, variantId)).toBe(0);
    expect(await salesOf(api, name)).toHaveLength(3);
  });
});
