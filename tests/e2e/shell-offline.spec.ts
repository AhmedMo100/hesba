import { test, expect } from "@playwright/test";

test.describe("App Shell Offline Navigation", () => {
  test("after one online visit, navigation between all pages works offline", async ({
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

    // No bottom bar: every screen opens from its home tile, and the back arrow returns home.
    const back = page.getByRole("button", { name: "رجوع للرئيسية" });
    for (const [route, screen] of [
      ["products", "page-products"],
      ["sales", "page-sales"],
      ["stock", "page-stock"],
      ["expenses", "page-expenses"],
      ["people", "page-people"],
      ["alerts", "page-alerts"],
      ["inventory", "page-inventory"],
      ["ai", "page-ai"],
    ] as const) {
      await page.getByTestId(`home-tile-${route}`).click({ force: true });
      await expect(page.getByTestId(screen)).toBeVisible();
      await back.click({ force: true });
      await expect(page.getByTestId("page-home")).toBeVisible();
    }
    // The reports, drawer and alerts pages load offline too (their data needs the network).
    for (const [testId, screen] of [
      ["home-sold-today", "page-reports"],
      ["home-drawer", "page-drawer"],
    ] as const) {
      await page.getByTestId(testId).click({ force: true });
      await expect(page.getByTestId(screen)).toBeVisible();
      await back.click({ force: true });
    }
  });
});
