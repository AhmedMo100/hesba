import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.describe("Auth & Profile UI at 360px (Phone + Password)", () => {
  // QA-54: a normal run must not rewrite the tracked documentation images. They are
  // regenerated only on purpose: HESBA_UPDATE_SCREENS=1 pnpm test:e2e auth-screens
  const screenshotsDir =
    process.env["HESBA_UPDATE_SCREENS"] === "1"
      ? path.resolve(process.cwd(), "docs/screens/phase-2")
      : path.resolve(process.cwd(), "test-results/screens/phase-2");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  const hideChrome = `
    nextjs-portal { display: none !important; }
    #dev-auth-toolbar { display: none !important; }
    nav { display: none !important; }
    *, *::before, *::after { animation: none !important; transition: none !important; }
  `;

  test("captures 360px screenshots for all auth screens and profile modal", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // 1. Signup (single step)
    await page.goto("/dev/auth?screen=signup-1");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

    await expect(page.locator("h1")).toHaveText("سجّل محلك");
    await expect(
      page.locator('input[placeholder="مثلاً: بقالة الأمل"]'),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup.png"),
      fullPage: false,
    });

    // 2. Login Screen
    await page.goto("/dev/auth?screen=login");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

    await expect(page.locator("h1")).toHaveText("حِسبة");
    await expect(page.locator("p").first()).toContainText("حساب محلك في جيبك");
    await expect(page.locator('input[placeholder="••••••"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-login.png"),
      fullPage: false,
    });

    // 3. Forgot Password Screen (Email + 6-digit code request)
    await page.goto("/dev/auth?screen=forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

    await expect(page.locator("h1")).toHaveText("نسيت كلمة السر؟");
    await expect(page.locator("p").first()).toContainText(
      "خطوة بسيطة وترجع لحسابك وتكمل شغلك.",
    );
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-forgot-password.png"),
      fullPage: false,
    });

    // 3b. Forgot Password Step 2 (Verification code entry + new password)
    await page.goto("/dev/auth?screen=forgot-password-code");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

    await expect(page.locator("h1")).toHaveText("تعيين كلمة السر الجديدة");
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-forgot-code.png"),
      fullPage: false,
    });

    // 3c. Password Reset Confirmation State
    await page.goto("/dev/auth?screen=reset-success");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

    await expect(page.locator("role=status")).toBeVisible();
    await expect(page.locator("role=status")).toContainText(
      "تم تغيير كلمة السر بنجاح",
    );
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-reset-success.png"),
      fullPage: false,
    });

    // 3d. Form Error Feedback State
    await page.goto("/dev/auth?screen=error-feedback");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

    await expect(
      page.getByRole("alert").filter({ hasText: "البيانات غير صحيحة" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-error-feedback.png"),
      fullPage: false,
    });

    // 4. Profile Modal
    await page.goto("/dev/auth?screen=profile");
    await page.waitForLoadState("domcontentloaded");
    await page.addStyleTag({ content: hideChrome });

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
    await expect(page.locator("h1")).toHaveText("حِسبة");
    await expect(page.locator("p").first()).toContainText("حساب محلك في جيبك");
    await expect(page.locator('input[placeholder="••••••"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");

    // 2. /login renders canonical login
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("حِسبة");
    await expect(page.locator("p").first()).toContainText("حساب محلك في جيبك");
    await expect(page.locator('input[placeholder="••••••"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");

    // 3. /signup renders registration
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("سجّل محلك");
    await expect(
      page.locator('input[placeholder="مثلاً: بقالة الأمل"]'),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");

    // 4. /forgot-password renders recovery request
    await page.goto("/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("نسيت كلمة السر؟");
    await expect(page.locator("p").first()).toContainText(
      "خطوة بسيطة وترجع لحسابك وتكمل شغلك.",
    );
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
  });

  test("persists theme between auth pages and defaults to light when unset", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // 1. Visit /login without saved theme -> defaults to light
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // 2. Click theme toggle button to switch to dark (if present)
    const toggleBtn = page.locator("button[aria-label*='المظهر']");
    const toggleVisible = await toggleBtn.isVisible().catch(() => false);
    if (toggleVisible) {
      await toggleBtn.click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      const saved = await page.evaluate(() =>
        localStorage.getItem("hesba-theme"),
      );
      expect(saved).toBe("dark");

      // 3. Navigate to /signup -> retains dark theme
      await page.goto("/signup");
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      // 4. Reload page -> retains dark theme
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    }
  });

  test("signup fields are stacked vertically and no horizontal overflow at 360px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");

    const phoneInput = page.locator("input[type='tel']");
    const emailInput = page.locator("input[type='email']");
    await expect(phoneInput).toBeVisible();
    await expect(emailInput).toBeVisible();

    const phoneBox = await phoneInput.boundingBox();
    const emailBox = await emailInput.boundingBox();
    expect(phoneBox).not.toBeNull();
    expect(emailBox).not.toBeNull();

    // Fields are stacked vertically
    expect(emailBox?.y ?? 0).toBeGreaterThan((phoneBox?.y ?? 0) + 30);

    // Ensure zero horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("navigation buttons work between login and signup", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // 1. Login page: «سجّل محلك لأول مرة» and «نسيت الباسورد؟»
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    const newAccountBtn = page.locator("button:has-text('سجّل محلك لأول مرة')");
    const forgotPwdLink = page.locator("button:has-text('نسيت الباسورد')");
    await expect(newAccountBtn).toBeVisible();
    await expect(forgotPwdLink).toBeVisible();

    // Click signup button → should go to signup
    await newAccountBtn.click();
    await expect(page.locator("h1")).toHaveText("سجّل محلك");

    // 2. Signup page: «عندي حساب، ادخل»
    const hasAccountBtn = page.locator("button:has-text('عندي حساب، ادخل')");
    await expect(hasAccountBtn).toBeVisible();

    // Click back to login
    await hasAccountBtn.click();
    await expect(page.locator("h1")).toHaveText("حِسبة");

    // 3. Forgot Password page: «رجوع لتسجيل الدخول»
    await page.goto("/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    const backToLoginLink = page.locator(
      "button:has-text('رجوع لتسجيل الدخول')",
    );
    await expect(backToLoginLink).toBeVisible();
  });

  test("forgot-password link opens the existing flow", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    await page.locator("button:has-text('نسيت الباسورد')").click();
    await expect(page.locator("h1")).toHaveText("نسيت كلمة السر؟");
    await expect(page.locator("input[type='email']")).toBeVisible();
  });

  test("email is optional on signup form", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");

    // Check that email label contains «اختياري»
    await expect(page.locator("text=اختياري")).toBeVisible();

    // The email field is type=email
    await expect(page.locator("input[type='email']")).toBeVisible();
  });

  test("captures dark mode screenshots at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });

    // Login dark
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    await page.addStyleTag({ content: hideChrome });
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-login-dark.png"),
      fullPage: false,
    });

    // Signup dark
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() =>
      document.documentElement.setAttribute("data-theme", "dark"),
    );
    await page.addStyleTag({ content: hideChrome });
    await page.screenshot({
      path: path.join(screenshotsDir, "auth-signup-dark.png"),
      fullPage: false,
    });
  });
});
