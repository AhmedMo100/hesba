import { test, expect } from "@playwright/test";

test.describe("App Shell Offline Navigation", () => {
  test("after one online visit, navigation between all 8 pages works offline", async ({
    page,
    context,
  }) => {
    // 1. First visit online
    await page.goto("/app");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForLoadState("networkidle");

    // Hide Next.js dev overlay portal so it doesn't intercept clicks in test
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });

    // Home page is visible initially
    await expect(page.locator('[data-testid="page-home"]')).toBeVisible();

    // 2. Go offline
    await context.setOffline(true);

    const isMobile = await page
      .locator('button[aria-label="المزيد"]:visible')
      .isVisible();

    const navigateTo = async (label: string, isMoreSubItem = false) => {
      if (isMobile && isMoreSubItem) {
        await page
          .locator('button[aria-label="المزيد"]:visible')
          .click({ force: true });
        const dialog = page.locator("role=dialog");
        await expect(dialog).toBeVisible();
        await dialog.locator("button").filter({ hasText: label }).click();
        await expect(dialog).toBeHidden();
      } else {
        await page
          .locator(`button[aria-label="${label}"]:visible`)
          .click({ force: true });
      }
    };

    // 3. Navigate to Products
    await navigateTo("المنتجات");
    await expect(page.locator('[data-testid="page-products"]')).toBeVisible();

    // 4. Navigate to Sales
    await navigateTo("البيع");
    await expect(page.locator('[data-testid="page-sales"]')).toBeVisible();

    // 5. Navigate to Stock
    await navigateTo("المخزون");
    await expect(page.locator('[data-testid="page-stock"]')).toBeVisible();

    // 6. Navigate to Expenses
    await navigateTo("المصاريف", true);
    await expect(page.locator('[data-testid="page-expenses"]')).toBeVisible();

    // 7. Navigate to People
    await navigateTo("الناس", true);
    await expect(page.locator('[data-testid="page-people"]')).toBeVisible();

    // 8. Navigate to Alerts
    await navigateTo("التنبيهات", true);
    await expect(page.locator('[data-testid="page-alerts"]')).toBeVisible();

    // 9. Navigate to AI
    await navigateTo("المساعد", true);
    await expect(page.locator('[data-testid="page-ai"]')).toBeVisible();

    // 10. Navigate back to Home
    await navigateTo("الرئيسية");
    await expect(page.locator('[data-testid="page-home"]')).toBeVisible();
  });
});
