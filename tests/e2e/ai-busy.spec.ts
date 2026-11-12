import { test, expect } from "@playwright/test";

/**
 * QA-29 (docs/QA/FULL-SYSTEM-AUDIT.md): when the assistant's provider is busy, the screen shows
 * a waiting state, then the server's readable "try again" message — never "[object Object]".
 * The chat endpoint is stubbed with the server's real 503 body; no provider is called.
 *
 * Needs a server whose database is safe to write to (the test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };
const BUSY =
  "المساعد مشغول دلوقتي ومردّش في الوقت. جرّب تاني بعد شوية، ورصيد رسالتك رجعلك.";

test("AI chat: a busy provider shows a waiting state, then a readable retry message", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const signup = await page.request.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل مساعد",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `ai-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Ai-busy-e2e-2026-ok",
      storeName: "محل مساعد",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(signup.ok()).toBe(true);

  let release: () => void = () => {};
  const answered = new Promise<void>((r) => (release = r));
  await page.route("**/api/ai/chat", async (route) => {
    await answered; // hold the reply so the waiting state is visible
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "Retry-After": "30" },
      body: JSON.stringify({
        error: { code: "SERVICE_UNAVAILABLE", message: BUSY },
      }),
    });
  });

  await page.goto("/app/ai");
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId("page-ai")).toBeVisible(PAGE_LOAD);
  await page
    .getByRole("textbox", { name: "اكتب سؤالك…" })
    .fill("مبيعات النهارده كام؟");
  await page.getByRole("button", { name: "إرسال" }).click();

  // Waiting state while the request is open.
  await expect(page.locator('[aria-live="polite"]').first()).toBeVisible();
  release();

  await expect(page.getByText(BUSY)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("[object Object]")).toHaveCount(0);
});
