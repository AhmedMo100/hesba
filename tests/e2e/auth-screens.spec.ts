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
    // Fill step 1 inputs to proceed
    await page.fill('input[placeholder="مثال: مجدي أحمد"]', "مجدي أحمد");
    await page.fill('input[placeholder="01xxxxxxxxx"]', "01012345678");
    await page.fill('input[placeholder="name@email.com"]', "magdy@example.com");
    await page.click('button:has-text("التالي")');

    // Confirm Step 2 is active
    await expect(
      page.locator('input[placeholder="مثال: سوبر ماركت البركة"]'),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-step2.png"),
      fullPage: false,
    });

    // 3. Passkey Registration Screen
    await page.goto("/dev/auth?screen=passkey-reg");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.locator("h1")).toHaveText("تسجيل مفتاح المرور (Passkey)");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-passkey-reg.png"),
      fullPage: false,
    });

    // 4. Login Screen (Passkey primary)
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
    await expect(page.locator("h1")).toHaveText("استرداد الحساب بالبريد");
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
