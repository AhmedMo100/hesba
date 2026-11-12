import { test, expect } from "@playwright/test";

test.describe("App Shell Offline Navigation", () => {
  test("after one online visit, navigation between all 8 pages works offline", async ({
    page,
    context,
  }) => {
    // 1. First visit online with authenticated session cookie
    await context.addCookies([
      {
        name: "hesba_session",
        value: "e2e-offline-token",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

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

    // Six screens around «البيع» in the navigation; Alerts from the top bar's bell.
    const navigateTo = async (label: string) => {
      if (label === "التنبيهات") {
        await page
          .locator('header button[aria-label^="جرس التنبيهات"]')
          .click({ force: true });
        return;
      }
      await page
        .locator(`nav:visible button[aria-label="${label}"]:visible`)
        .first()
        .click({ force: true });
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
    await navigateTo("المصاريف");
    await expect(page.locator('[data-testid="page-expenses"]')).toBeVisible();

    // 7. Navigate to People
    await navigateTo("الناس");
    await expect(page.locator('[data-testid="page-people"]')).toBeVisible();

    // 8. Navigate to Alerts
    await navigateTo("التنبيهات");
    await expect(page.locator('[data-testid="page-alerts"]')).toBeVisible();

    // 9. Navigate to AI
    await navigateTo("المساعد");
    await expect(page.locator('[data-testid="page-ai"]')).toBeVisible();

    // 10. Navigate back to Home
    await navigateTo("الرئيسية");
    await expect(page.locator('[data-testid="page-home"]')).toBeVisible();
  });
});
