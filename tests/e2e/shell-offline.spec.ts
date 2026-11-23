import { test, expect } from "@playwright/test";

test.describe("App Shell Offline Navigation", () => {
  test("after one online visit, navigation between all pages works offline", async ({
    page,
    context,
  }) => {
    // 1. First visit online, signed in for real: the app shows nothing of a shop to a cookie the
    //    server does not recognize, so the offline copy must come from a real session.
    const phone = `012${Math.floor(1e7 + Math.random() * 9e7)}`;
    const signup = await page.request.post("/api/auth/signup", {
      data: {
        ownerName: "محل أوفلاين",
        phone,
        password: "Offline-shell-2026",
        storeName: `محل أوفلاين ${Date.now().toString(36)}`,
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
        operatingMode: "pos",
      },
    });
    expect(signup.status()).toBe(200);
    void context;

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
      // The stand-alone machines page is gone: machines live in «الخدمات والعمولات».
      ["services", "page-services"],
      ["money", "page-money"],
      ["stocktake", "page-stocktake"],
      ["inventory", "page-inventory"],
      ["ai", "page-ai"],
    ] as const) {
      await page.getByTestId(`home-tile-${route}`).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      await back.click();
      await expect(page.getByTestId("page-home")).toBeVisible();
    }
    // The reports, drawer and alerts pages load offline too (their data needs the network).
    for (const [testId, screen] of [
      ["home-sold-today", "page-reports"],
      ["home-drawer", "page-drawer"],
    ] as const) {
      // A real shop's home settles as its offline copy loads: a normal click waits until the
      // tile is stable and really on top (a forced click can land on a neighbour mid-layout).
      await page.getByTestId(testId).click();
      await expect(page.getByTestId(screen)).toBeVisible();
      await back.click();
    }
  });
});
