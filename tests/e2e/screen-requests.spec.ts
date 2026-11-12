import { test, expect } from "@playwright/test";

/**
 * Part of QA-32 / the performance pass (ADR-0027): how many API requests each main screen makes
 * to load, and that it makes none while the shopkeeper just looks at it. Duplicates of the same
 * GET during one load are listed, so a component that refetches on every render shows up.
 *
 * Needs a server whose database is safe to write to (the test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };
const screens: Array<[string, string]> = [
  ["/app", "page-home"],
  ["/app/sales", "page-sales"],
  ["/app/products", "page-products"],
  ["/app/people", "page-people"],
  ["/app/alerts", "page-alerts"],
  ["/app/stock", "page-stock"],
];

test("main screens: requests to load, duplicates, and none while idle", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const signup = await page.request.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل قياس",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `req-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Requests-e2e-2026-ok",
      storeName: "محل قياس",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(signup.ok()).toBe(true);

  let log: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/") && r.method() === "GET")
      log.push(u.pathname + u.search);
  });

  const report: Record<
    string,
    { load: number; duplicates: string[]; idle: number }
  > = {};
  for (const [path, testId] of screens) {
    log = [];
    await page.goto(path);
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.getByTestId(testId)).toBeVisible(PAGE_LOAD);
    await page.waitForLoadState("networkidle");
    const loaded = [...log];
    log = [];
    await page.waitForTimeout(10_000);
    const counts = new Map<string, number>();
    for (const u of loaded) counts.set(u, (counts.get(u) ?? 0) + 1);
    report[path] = {
      load: loaded.length,
      duplicates: [...counts]
        .filter(([, n]) => n > 1)
        .map(([u, n]) => `${u}×${n}`),
      idle: log.length,
    };
  }
  console.log("SCREEN_REQUESTS " + JSON.stringify(report));
  for (const r of Object.values(report)) expect(r.idle).toBe(0);
  // On a production build (`next start`) a screen asks for each URL once. A dev server's React
  // StrictMode runs effects twice on purpose, so duplicates are only checked there.
  if (process.env["HESBA_E2E_PRODUCTION"] === "1") {
    for (const r of Object.values(report)) expect(r.duplicates).toEqual([]);
    expect(report["/app/sales"]!.load).toBeLessThanOrEqual(9);
  }
});
