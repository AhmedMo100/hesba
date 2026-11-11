import { test, expect, type Page } from "@playwright/test";

/**
 * QA-26 against a real server and browser: every kind of response carries the security
 * headers, and the CSP does not block anything the app legitimately loads (no violations on
 * the main screens, fonts and scripts load, sign-up and navigation work).
 */

const REQUIRED = [
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
];

function randomPhone(): string {
  return `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) {
      violations.push(m.text().slice(0, 300));
    }
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(
        `Refused to load (CSP ${e.violatedDirective}) ${e.blockedURI}`,
      );
    });
  });
  return violations;
}

test.describe("Security headers and CSP", () => {
  test("headers on pages, redirects, API successes and errors, and static files", async ({
    request,
  }) => {
    const cases: Array<{ path: string; method?: string; status: number }> = [
      { path: "/", status: 200 },
      { path: "/login", status: 200 },
      { path: "/forgot-password", status: 200 },
      { path: "/api/health", status: 200 },
      { path: "/api/sales", status: 401 },
      {
        path: "/api/auth/forgot-password/request",
        method: "POST",
        status: 400,
      },
      { path: "/fonts/tajawal/tajawal-400-arabic.woff2", status: 200 },
    ];
    for (const c of cases) {
      const res =
        c.method === "POST"
          ? await request.post(c.path, {
              data: "{bad",
              headers: { "content-type": "application/json" },
            })
          : await request.get(c.path, { maxRedirects: 0 });
      expect(res.status(), c.path).toBe(c.status);
      const h = res.headers();
      for (const key of REQUIRED)
        expect(h[key], `${key} on ${c.path}`).toBeTruthy();
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["x-powered-by"]).toBeUndefined();
    }
    const redirect = await request.get("/app", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["content-security-policy"]).toBeTruthy();
  });

  test("the app works under the CSP: no violations on the main screens", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const violations = await watchCsp(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const runId = Math.random().toString(36).slice(2, 7);
    const signup = await page.request.post("/api/auth/signup", {
      data: {
        ownerName: "صاحب محل أمان",
        phone: randomPhone(),
        email: `csp-e2e-${runId}@hesba.test`,
        password: "Csp-e2e-2026-ok",
        storeName: `محل أمان ${runId}`,
        shopType: "سوبر ماركت",
        governorate: "القاهرة",
      },
    });
    expect(signup.ok()).toBe(true);
    for (const path of [
      "/app",
      "/app/sales",
      "/app/products",
      "/app/stock",
      "/app/people",
    ]) {
      await page.goto(path);
      await expect(page.locator("[data-testid^='page-']").first()).toBeVisible({
        timeout: 45_000,
      });
    }
    // The self-hosted font actually loaded (font-src 'self').
    const fontsOk = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some(
        (f) => f.family.includes("Tajawal") && f.status === "loaded",
      );
    });
    expect(fontsOk).toBe(true);
    expect(violations).toEqual([]);
  });
});
