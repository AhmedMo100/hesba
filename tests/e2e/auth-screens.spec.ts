import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.describe("Auth & Profile UI at 360px (P2-F-01, P2-F-02, P2-F-06)", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screens/phase-2");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("captures 360px screenshots for all auth screens and profile modal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // 1. Signup Step 1 ("عنك")
    await page.goto("/dev/auth?screen=signup-1");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });

    await expect(page.locator("h1")).toHaveText("افتح حساب حسبة");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-step1.png"),
      fullPage: false,
    });

    // 2. Signup Step 2 ("محلك")
    const testId = Math.random().toString(36).substring(2, 7);
    const testPhone = `010${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testEmail = `magdy_${testId}@example.com`;

    await page.fill('input[placeholder="مثال: مجدي أحمد"]', "مجدي أحمد");
    await page.fill('input[placeholder="01xxxxxxxxx"]', testPhone);
    await page.fill('input[placeholder="name@email.com"]', testEmail);
    await page.click('button:has-text("التالي")');

    await expect(
      page.locator('input[placeholder="مثال: سوبر ماركت البركة"]'),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-step2.png"),
      fullPage: false,
    });

    // 3. Signup Step 3 ("أمان الجهاز" - Local PIN)
    await page.fill(
      'input[placeholder="مثال: سوبر ماركت البركة"]',
      "سوبر ماركت البركة",
    );
    await page.click('button:has-text("التالي")');

    await expect(page.locator("h3")).toContainText("أمان الجهاز");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-step3.png"),
      fullPage: false,
    });

    // 4. Login Screen (Magic link)
    await page.goto("/dev/auth?screen=login");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.locator("h1")).toHaveText("أهلاً بيك تاني");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-login.png"),
      fullPage: false,
    });

    // 5. Account Recovery Screen
    await page.goto("/dev/auth?screen=recovery");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.locator("h1")).toHaveText(
      "استرداد الحساب وإعادة ضبط PIN",
    );
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-recovery.png"),
      fullPage: false,
    });

    // 6. PIN Lock Screen
    await page.goto("/dev/auth?screen=pin");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.locator("h2")).toHaveText("قفل التطبيق برمز PIN");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-pin-lock.png"),
      fullPage: false,
    });

    // 7. Profile Modal
    await page.goto("/dev/auth?screen=profile");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.locator("role=dialog")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "profile-modal.png"),
      fullPage: false,
    });
  });
});
