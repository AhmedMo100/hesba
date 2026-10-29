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
    await expect(page.locator("p").first()).toContainText(
      "ابدأ تنظيم حسابات محلك ومخزونه مع حِسبة.",
    );
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
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
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
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
    await expect(page.locator("p").first()).toContainText(
      "أهلاً بعودتك، خلّي إدارة محلك أسهل مع حِسبة.",
    );
    await expect(page.locator('input[placeholder="كلمة السر"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
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
    await expect(page.locator("p").first()).toContainText(
      "خطوة بسيطة وترجع لحسابك وتكمل شغلك.",
    );
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");
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
    await expect(page.locator("p").first()).toContainText(
      "أهلاً بعودتك، خلّي إدارة محلك أسهل مع حِسبة.",
    );
    await expect(page.locator('input[placeholder="كلمة السر"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");

    // 2. /login renders canonical login
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("أهلاً بيك تاني");
    await expect(page.locator("p").first()).toContainText(
      "أهلاً بعودتك، خلّي إدارة محلك أسهل مع حِسبة.",
    );
    await expect(page.locator('input[placeholder="كلمة السر"]')).toBeVisible();
    await expect(page.locator("body")).not.toContainText("نسخة تجريبية");

    // 3. /signup renders registration flow
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("h1")).toHaveText("افتح حساب حسبة");
    await expect(page.locator("p").first()).toContainText(
      "ابدأ تنظيم حسابات محلك ومخزونه مع حِسبة.",
    );
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

    // 2. Click theme toggle button to switch to dark
    const toggleBtn = page.locator("button[aria-label*='المظهر']");
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // Check localStorage
    const saved = await page.evaluate(() =>
      localStorage.getItem("hesba-theme"),
    );
    expect(saved).toBe("dark");

    // 3. Navigate to /signup -> retains dark theme
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // 4. Reload page -> retains dark theme (zero flicker)
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("renders live password requirements indicator as user types", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/signup");
    await page.waitForLoadState("domcontentloaded");

    // Check that requirement indicators exist
    await expect(page.locator("text=12 حرفًا على الأقل")).toBeVisible();
    await expect(page.locator("text=حرف واحد على الأقل")).toBeVisible();
    await expect(page.locator("text=رقم واحد على الأقل")).toBeVisible();

    const passwordInput = page.locator("input[autocomplete='new-password']");
    await passwordInput.fill("OnlyLettersNoDigitsHere");
    // Length is 23, has letters, but no digits
    await expect(page.locator("text=رقم واحد على الأقل")).toBeVisible();

    // Fill with letters and digits >= 12
    await passwordInput.fill("SecurePass2026!");
    await expect(page.locator("text=12 حرفًا على الأقل")).toBeVisible();
  });
});
