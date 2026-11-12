import { test, expect } from "@playwright/test";

/**
 * QA-28 (docs/QA/FULL-SYSTEM-AUDIT.md): the Alerts screen must not repeat requests while the
 * shopkeeper just looks at it. Before the fix, 12 idle seconds made 6–8 `GET /api/machines` and
 * 5 `GET /api/alerts` (the machines fetch dispatched the event that made it fetch again).
 *
 * Needs a server whose database is safe to write to (the test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };

test("Alerts screen: loads once, then makes no repeated requests while idle", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const api = page.request;
  const signup = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل تنبيهات",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `alerts-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Alerts-e2e-2026-ok",
      storeName: "محل تنبيهات",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(signup.ok()).toBe(true);
  // A machine, so the screen has machines to load (the loop needed a machines fetch).
  const machine = await api.post("/api/machines", {
    data: { name: "ماكينة فوري", provider: "fawry" },
  });
  expect(machine.status()).toBe(201);

  const counts = { machines: 0, alerts: 0 };
  let counting = false;
  page.on("request", (req) => {
    if (!counting || req.method() !== "GET") return;
    const path = new URL(req.url()).pathname;
    if (path === "/api/machines") counts.machines += 1;
    if (path === "/api/alerts") counts.alerts += 1;
  });

  await page.goto("/app/alerts");
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId("page-alerts")).toBeVisible(PAGE_LOAD);
  await page.waitForLoadState("networkidle");

  counting = true;
  await page.waitForTimeout(12_000); // the audit's idle window
  counting = false;

  expect(counts).toEqual({ machines: 0, alerts: 0 });
});
