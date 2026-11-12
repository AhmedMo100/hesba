import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * QA-06 / QA-07 / QA-08 (ADR-0021) against a real server and database: the Home "التقرير"
 * tab shows the real sales and expenses of today, the cost of goods sold from the batches
 * that were consumed (the total paid, not a per-unit misread), the purchases as the total
 * paid, and "—" for cost and profit as soon as one sale has no recorded cost (never 75%/25%).
 *
 * Needs a server whose database is safe to write to (the test signs up a new store).
 */

const SERVER = { timeout: 20_000 };
const PAGE_LOAD = { timeout: 45_000 };

function randomPhone(): string {
  return `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

async function product(
  api: APIRequestContext,
  name: string,
  sell: number,
  buy: number,
): Promise<string> {
  const res = await api.post("/api/products", {
    data: {
      nameAr: name,
      category: "مشروبات",
      unit: "piece",
      sellPricePiasters: sell,
      buyCostPiasters: buy,
      isCustom: true,
      variants: [
        { packQty: 1, sellPricePiasters: sell, costPricePiasters: buy },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).data.variants[0].id;
}

async function sell(api: APIRequestContext, variantId: string, qty: number) {
  const res = await api.post("/api/sales", {
    data: { variantId, quantityBase: qty, opId: crypto.randomUUID() },
  });
  expect(res.ok()).toBe(true);
}

test.describe("Home report", () => {
  test("real sales, expenses, recorded cost, purchases, and unknown cost as —", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const runId = Math.random().toString(36).slice(2, 7);
    const api = page.request;
    const signup = await api.post("/api/auth/signup", {
      data: {
        ownerName: "صاحب محل تقرير",
        phone: randomPhone(),
        email: `home-e2e-${runId}@hesba.test`,
        password: "Home-e2e-2026-ok",
        storeName: `محل تقرير ${runId}`,
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
      },
    });
    expect(signup.ok()).toBe(true);

    // 2 pieces bought for 20.00 in total, both sold at 15.00 → 30.00 revenue, 20.00 cost.
    const known = await product(api, `عصير ${runId}`, 1500, 1000);
    const add = await api.post("/api/stock", {
      data: {
        action: "add",
        storeVariantId: known,
        quantityBase: 2,
        costTotalPiasters: 2000,
      },
    });
    expect(add.ok()).toBe(true);
    await sell(api, known, 2);
    const exp = await api.post("/api/expenses", {
      data: { category: "كهرباء", amountPiasters: 12345 },
    });
    expect(exp.status()).toBe(201);

    await page.goto("/app");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.getByText("التقرير", { exact: true }).click(PAGE_LOAD);
    await expect(page.getByTestId("home-revenue")).toHaveText("30 ج.م", SERVER);
    await expect(page.getByTestId("home-expenses")).toHaveText("123.45 ج.م");
    await expect(page.getByTestId("home-cogs")).toHaveText("20 ج.م");
    await expect(page.getByTestId("home-profit")).toHaveText("10 ج.م");
    await expect(page.getByTestId("home-purchases")).toHaveText("20 ج.م");

    // A piece received with no cost, then sold → cost and profit become unknown ("—").
    const unknown = await product(api, `بسكويت ${runId}`, 500, 0);
    const addUnknown = await api.post("/api/stock", {
      data: { action: "add", storeVariantId: unknown, quantityBase: 1 },
    });
    expect(addUnknown.ok()).toBe(true);
    await sell(api, unknown, 1);

    await page.reload();
    await page.getByText("التقرير", { exact: true }).click(PAGE_LOAD);
    await expect(page.getByTestId("home-revenue")).toHaveText("35 ج.م", SERVER);
    await expect(page.getByTestId("home-cogs")).toHaveText("—");
    await expect(page.getByTestId("home-profit")).toHaveText("—");
    await expect(page.getByText("1 بيعة تكلفتها مش متسجلة")).toBeVisible();
  });
});
