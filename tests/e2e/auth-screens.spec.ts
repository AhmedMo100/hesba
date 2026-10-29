import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.describe("Auth & Profile UI at 360px (Phone + Password)", () => {
  const screenshotsDir = path.resolve(process.cwd(), "docs/screens/phase-2");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("captures 360px screenshots for all phone + password auth screens and profile modal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // 1. Signup Step 1 ("عنك")
    await page.goto("/dev/auth?screen=signup-1");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });

    await expect(page.locator("h1")).toHaveText("افتح حساب حسبة");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-step1.png"),
      fullPage: false,
    });

    // 2. Signup Step 2 ("محلك")
    await page.goto("/dev/auth?screen=signup-2");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(
      page.locator('input[placeholder="مثال: سوبر ماركت البركة"]'),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-step2.png"),
      fullPage: false,
    });

    // 3. Login Screen (Phone + Password)
    await page.goto("/dev/auth?screen=login");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(page.locator("h1")).toHaveText("أهلاً بيك تاني");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-login.png"),
      fullPage: false,
    });

    // 4. Forgot Password Screen (Email + 6-digit code request)
    await page.goto("/dev/auth?screen=forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(page.locator("h1")).toHaveText("نسيت كلمة السر؟");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-forgot-password.png"),
      fullPage: false,
    });

    // 4b. Forgot Password Step 2 (Verification code entry + new password)
    await page.goto("/dev/auth?screen=forgot-password-code");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(page.locator("h1")).toHaveText("تعيين كلمة السر الجديدة");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-forgot-code.png"),
      fullPage: false,
    });

    // 4c. Password Reset Confirmation State
    await page.goto("/dev/auth?screen=reset-success");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(page.locator("role=status")).toBeVisible();
    await expect(page.locator("role=status")).toContainText(
      "تم تغيير كلمة السر بنجاح",
    );
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-reset-success.png"),
      fullPage: false,
    });

    // 4d. Form Error Feedback State
    await page.goto("/dev/auth?screen=error-feedback");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "رقم الموبايل أو كلمة السر غير صحيحة" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-error-feedback.png"),
      fullPage: false,
    });

    // 5. Profile Modal
    await page.goto("/dev/auth?screen=profile");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({
      content: `
        nextjs-portal { display: none !important; }
        #dev-auth-toolbar { display: none !important; }
        nav { display: none !important; }
        *, *::before, *::after { animation: none !important; transition: none !important; }
      `,
    });
    await expect(page.locator("role=dialog")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "profile-modal.png"),
      fullPage: false,
    });
  });

  test("canonical public auth routes render correctly at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // 1. Root route / renders login
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("أهلاً بيك تاني");

    // 2. /login renders canonical login
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("أهلاً بيك تاني");

    // 3. /signup renders registration flow
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("افتح حساب حسبة");

    // 4. /forgot-password renders recovery request
    await page.goto("/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("نسيت كلمة السر؟");
  });
});
