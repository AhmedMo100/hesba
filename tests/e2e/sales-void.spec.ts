import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * QA-09 / QA-10 (ADR-0022) against a real server and database:
 *   A. An old local copy of the sales list (with a sale the server never recorded) and a server
 *      with no sales → the screen shows no sales and 0, never the local copy.
 *   B. A sale the server rejects (not enough stock) is not counted; the recorded one is.
 *   C. Undo (تراجع) → the server voids the sale: the stock comes back exactly, the sale stays
 *      listed as voided, today's total drops; after a reload it is still voided and not
 *      counted; a second void restores nothing.
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

test.describe("Sales screen: server-only totals and undo", () => {
  test("stale local copy ignored, rejected sale not counted, undo is a server void", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const runId = Math.random().toString(36).slice(2, 7);
    const api = page.request;
    const signup = await api.post("/api/auth/signup", {
      data: {
        ownerName: "صاحب محل تراجع",
        phone: randomPhone(),
        email: `void-e2e-${runId}@hesba.test`,
        password: "Void-e2e-2026-ok",
        storeName: `محل تراجع ${runId}`,
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
      },
    });
    expect(signup.ok()).toBe(true);
    const storeId: string = (await (await api.get("/api/auth/session")).json())
      .data.store.id;

    const name = `كولا ${runId}`;
    const product = await api.post("/api/products", {
      data: {
        nameAr: name,
        category: "مشروبات",
        unit: "piece",
        sellPricePiasters: 1500,
        buyCostPiasters: 1000,
        isCustom: true,
        variants: [
          { packQty: 1, sellPricePiasters: 1500, costPricePiasters: 1000 },
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
            quantityBase: 2,
            costTotalPiasters: 2000,
          },
        })
      ).ok(),
    ).toBe(true);

    // ---- A. A stale local copy from an older version, and no sales on the server ----------
    await page.addInitScript(
      ({ key, value }) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem(key, value);
          sessionStorage.setItem("seeded", "1");
        }
      },
      {
        key: `hesba_sales_records_${storeId}`,
        value: JSON.stringify([
          {
            id: "rejected-before",
            productId: "x",
            name: `مرفوضة ${runId}`,
            amountPiasters: 1000,
            quantity: 1,
            category: "مشروبات",
            unit: "piece",
            timestamp: Date.now(),
          },
        ]),
      },
    );
    await page.goto("/app/sales");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    const total = page.getByTestId("today-sales-total");
    const tile = page.getByRole("button", { name: `بيع ${name}` });
    await expect(tile).toBeVisible(PAGE_LOAD);
    await expect(total).toHaveText("0 ج.م", SERVER);
    await expect(page.getByText(`مرفوضة ${runId}`)).toHaveCount(0);
    expect(
      await page.evaluate(
        (k) => localStorage.getItem(k),
        `hesba_sales_records_${storeId}`,
      ),
    ).toBeNull();

    // ---- B. One recorded sale, then one the server rejects --------------------------------
    await tile.click();
    await expect(page.getByText(`تم تسجيل بيع: ${name}`)).toBeVisible(SERVER);
    await expect(total).toHaveText("15 ج.م", SERVER);
    // Another device sells the last piece; this screen still shows 1 in stock.
    const elsewhere = await api.post("/api/sales", {
      data: { variantId, quantityBase: 1, opId: crypto.randomUUID() },
    });
    expect(elsewhere.ok()).toBe(true);
    await tile.click();
    await expect(page.getByText("الكمية في المخزن مش كفاية")).toBeVisible(
      SERVER,
    );
    await page.reload();
    await expect(tile).toBeVisible(PAGE_LOAD);
    // Two recorded sales (this screen's and the other device's), the rejected one is absent.
    await expect(total).toHaveText("30 ج.م", SERVER);
    await expect(page.getByTestId("recent-sale-row")).toHaveCount(2);
    expect(await stockOf(api, variantId)).toBe(0);

    // ---- C. Undo a sale -----------------------------------------------------------------
    await api.post("/api/stock", {
      data: {
        action: "add",
        storeVariantId: variantId,
        quantityBase: 3,
        costTotalPiasters: 3000,
      },
    });
    await page.reload();
    await expect(tile).toBeVisible(PAGE_LOAD);
    expect(await stockOf(api, variantId)).toBe(3);
    const voidPosts: number[] = [];
    page.on("response", (r) => {
      if (new URL(r.url()).pathname === "/api/sales/void")
        voidPosts.push(r.status());
    });
    await tile.click();
    await expect(page.getByText(`تم تسجيل بيع: ${name}`)).toBeVisible(SERVER);
    // Undo straight from the success toast (it stays a few seconds, like the demo's).
    await page.getByTestId("sale-undo").click();
    await expect(
      page.getByText(`اتلغت البيعة ورجعت الكمية للمخزن: ${name}`),
    ).toBeVisible(SERVER);
    expect(voidPosts).toEqual([200]);
    expect(await stockOf(api, variantId)).toBe(3);
    await expect(total).toHaveText("30 ج.م", SERVER);
    await expect(
      page.locator('[data-testid="recent-sale-row"][data-voided="true"]'),
    ).toHaveCount(1, SERVER);

    await page.reload();
    await expect(tile).toBeVisible(PAGE_LOAD);
    await expect(total).toHaveText("30 ج.م", SERVER);
    const voidedRow = page.locator(
      '[data-testid="recent-sale-row"][data-voided="true"]',
    );
    await expect(voidedRow).toHaveCount(1);
    await expect(voidedRow.getByText("اتلغت")).toBeVisible();

    // A second void of the same sale restores nothing.
    const list = await (await api.get("/api/sales")).json();
    const voided = list.sales.find((s: { voided: boolean }) => s.voided);
    const again = await api.post("/api/sales/void", {
      data: { saleId: voided.id, opId: crypto.randomUUID() },
    });
    expect(again.ok()).toBe(true);
    expect((await again.json()).data.alreadyVoided).toBe(true);
    expect(await stockOf(api, variantId)).toBe(3);
  });
});
