import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * QA-04 (docs/QA/FULL-SYSTEM-AUDIT.md, ADR-0020): offline sales are queued durably in the
 * browser's real IndexedDB, shown as waiting (never as done), survive a refresh and a closed
 * tab, and sync to the real server exactly once — including after a lost response, a server
 * error, two tabs syncing at once, and a stock rejection. A queued sale of one shop is never
 * sent while another shop is signed in.
 *
 * Needs a server whose database is safe to write to (the test signs up new stores).
 */

const SERVER = { timeout: 30_000 };
const PAGE_LOAD = { timeout: 60_000 };

function randomPhone(): string {
  return `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`;
}

async function signup(api: APIRequestContext, tag: string): Promise<string> {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل أوفلاين",
      phone: randomPhone(),
      email: `offline-e2e-${tag}-${Date.now()}@hesba.test`,
      password: "Offline-e2e-2026-ok",
      storeName: `محل أوفلاين ${tag}`,
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(res.ok()).toBe(true);
  // The token is only in the HttpOnly cookie (QA-40), never in the body.
  const cookie = res.headers()["set-cookie"] ?? "";
  const token = /hesba_session=([^;]+)/.exec(cookie)?.[1];
  expect(token).toBeTruthy();
  return token!;
}

async function product(
  api: APIRequestContext,
  nameAr: string,
  stock: number,
): Promise<string> {
  const res = await api.post("/api/products", {
    data: {
      nameAr,
      category: "مشروبات",
      unit: "piece",
      sellPricePiasters: 1000,
      buyCostPiasters: 700,
      isCustom: true,
      variants: [
        { packQty: 1, sellPricePiasters: 1000, costPricePiasters: 700 },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const variantId: string = (await res.json()).data.variants[0].id;
  const add = await api.post("/api/stock", {
    data: {
      action: "add",
      storeVariantId: variantId,
      quantityBase: stock,
      costPricePiasters: 700 * stock,
    },
  });
  expect(add.ok()).toBe(true);
  return variantId;
}

async function stockOf(api: APIRequestContext, variantId: string) {
  const body = await (await api.get("/api/stock")).json();
  return body.inventory.find(
    (i: { variantId: string }) => i.variantId === variantId,
  )?.currentStockBase as number;
}

async function serverSales(api: APIRequestContext, name: string) {
  const body = await (await api.get("/api/sales")).json();
  return (body.sales as Array<{ name: string }>).filter((s) => s.name === name)
    .length;
}

async function openSales(page: Page) {
  await page.goto("/app/sales");
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId("page-sales")).toBeVisible(PAGE_LOAD);
}

/** Blocks the sale endpoint for pages of this context (the server is "unreachable"). */
async function blockSales(context: BrowserContext) {
  await context.route("**/api/sales", (route) =>
    route.request().method() === "POST"
      ? route.abort("failed")
      : route.continue(),
  );
}

async function outboxCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("hesba_db");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result
            .transaction("outbox", "readonly")
            .objectStore("outbox")
            .count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

test.describe("Offline sales (outbox)", () => {
  test("queue offline, survive refresh and reopen, sync once, recover from failures", async ({
    page,
    context,
  }) => {
    test.setTimeout(480_000);
    const api = page.request;
    const run = Math.random().toString(36).slice(2, 7);
    const tokenA = await signup(api, `a-${run}`);
    const colaName = `كولا ${run}`;
    const juiceName = `عصير ${run}`;
    const cola = await product(api, colaName, 10);
    const juice = await product(api, juiceName, 1);

    await openSales(page);
    const colaTile = page.getByRole("button", { name: `بيع ${colaName}` });
    const juiceTile = page.getByRole("button", { name: `بيع ${juiceName}` });
    await expect(colaTile).toBeVisible(PAGE_LOAD);
    await expect(juiceTile).toBeVisible(PAGE_LOAD);
    const rows = page.getByTestId("sale-queue-row");
    const toast = page.getByTestId("sale-toast");

    // ---- 1. Offline: three sales are queued and shown as waiting, never as done ---------
    await context.setOffline(true);
    for (let i = 0; i < 3; i++) {
      await colaTile.click();
      await expect(toast).toHaveAttribute("data-kind", "pending");
    }
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute("data-status", "pending");
    await expect(page.getByText(`تم تسجيل بيع: ${colaName}`)).toHaveCount(0);
    await expect(page.getByRole("status").first()).toContainText("3");
    expect(await serverSales(api, colaName)).toBe(0);
    expect(await stockOf(api, cola)).toBe(10);

    // ---- 2. Refresh while the server is unreachable: still queued -------------------------
    await blockSales(context);
    await context.setOffline(false);
    await page.reload();
    await expect(rows).toHaveCount(3, PAGE_LOAD);
    expect(await outboxCount(page)).toBe(3);

    // ---- 3. Close the tab and reopen the app: still queued ------------------------------
    await page.close();
    const page2 = await context.newPage();
    await openSales(page2);
    const rows2 = page2.getByTestId("sale-queue-row");
    await expect(rows2).toHaveCount(3, PAGE_LOAD);
    expect(await serverSales(api, colaName)).toBe(0);

    // ---- 4. Server reachable again: all three sync, exactly once ------------------------
    await context.unrouteAll({ behavior: "wait" });
    await page2.getByTestId("sale-queue-sync").click();
    await expect(rows2).toHaveCount(0, SERVER);
    expect(await serverSales(api, colaName)).toBe(3);
    expect(await stockOf(api, cola)).toBe(7);
    await expect(page2.getByRole("status").first()).toContainText("متزامن");

    // ---- 5. Lost response: the server commits, the answer never arrives ----------------
    await context.route("**/api/sales", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fetch(); // reaches the server, which records the sale
      await route.abort("failed"); // …but the browser never gets the answer
    });
    const colaTile2 = page2.getByRole("button", { name: `بيع ${colaName}` });
    await colaTile2.click();
    await expect(page2.getByTestId("sale-toast")).toHaveAttribute(
      "data-kind",
      "pending",
      SERVER,
    );
    await expect(rows2).toHaveCount(1);
    expect(await serverSales(api, colaName)).toBe(4); // already recorded on the server
    await context.unrouteAll({ behavior: "wait" });
    await page2.getByTestId("sale-queue-sync").click();
    await expect(rows2).toHaveCount(0, SERVER);
    expect(await serverSales(api, colaName)).toBe(4); // the retry did not sell again
    expect(await stockOf(api, cola)).toBe(6);

    // ---- 6. Server error (500): kept and retried, then recorded once --------------------
    await context.route("**/api/sales", (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "خطأ مؤقت" } }),
          })
        : route.continue(),
    );
    await colaTile2.click();
    await expect(rows2).toHaveCount(1, SERVER);
    await expect(rows2.first()).toHaveAttribute("data-status", "pending");
    await context.unrouteAll({ behavior: "wait" });

    // ---- 7. Two tabs sync at the same time: still one sale ------------------------------
    const page3 = await context.newPage();
    await openSales(page3);
    // Opening a tab syncs waiting sales by itself, so the queue (and its "sync now" button)
    // may already be gone when the clicks arrive: the clicks are best-effort, and the checks
    // below — one sale, stock taken once, both queues empty — are what this step proves.
    const syncNow = (p: typeof page2) =>
      p
        .getByTestId("sale-queue-sync")
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    await Promise.all([syncNow(page2), syncNow(page3)]);
    await expect(rows2).toHaveCount(0, SERVER);
    await expect(page3.getByTestId("sale-queue-row")).toHaveCount(0, SERVER);
    expect(await serverSales(api, colaName)).toBe(5);
    expect(await stockOf(api, cola)).toBe(5);
    await page3.close();

    // ---- 8. Rejection: two offline sales of the last piece → one recorded, one for review
    await context.setOffline(true);
    const juiceTile2 = page2.getByRole("button", { name: `بيع ${juiceName}` });
    await juiceTile2.click();
    await juiceTile2.click();
    await expect(rows2).toHaveCount(2);
    await context.setOffline(false); // the "online" event starts the sync
    await expect(rows2).toHaveCount(1, SERVER);
    await expect(rows2.first()).toHaveAttribute(
      "data-status",
      "rejected",
      SERVER,
    );
    await expect(rows2.first()).toContainText("مش كفاية");
    await expect(page2.getByRole("status").first()).toContainText("مراجعة");
    expect(await serverSales(api, juiceName)).toBe(1);
    expect(await stockOf(api, juice)).toBe(0); // never negative
    await rows2.first().getByRole("button", { name: "إلغاء البيعة" }).click();
    await expect(rows2).toHaveCount(0);
    expect(await serverSales(api, juiceName)).toBe(1);

    // ---- 9. Tenant: shop A's queued sale is never sent while shop B is signed in --------
    await blockSales(context); // the sale stays queued for shop A
    await colaTile2.click();
    await expect(rows2).toHaveCount(1, SERVER);
    const tokenB = await signup(api, `b-${run}`); // the browser is now signed in as shop B
    await openSales(page2); // reload as shop B (sales still blocked)
    await context.unrouteAll({ behavior: "wait" }); // the server is reachable again
    // Shop B's screen and sync: shop A's sale is not listed and not sent.
    await expect(page2.getByTestId("sale-queue")).toHaveCount(0);
    await page2.reload(); // a fresh start triggers a sync for shop B
    await expect(page2.getByTestId("page-sales")).toBeVisible(PAGE_LOAD);
    await page2.waitForTimeout(5_000);
    await expect(page2.getByTestId("sale-queue")).toHaveCount(0);
    expect(await outboxCount(page2)).toBe(1); // A's sale is kept, untouched
    expect(await serverSales(api, colaName)).toBe(0); // shop B recorded nothing
    expect(tokenB).not.toBe(tokenA);
    // Back to shop A: its sale is synced on startup, exactly once.
    await context.addCookies([
      {
        name: "hesba_session",
        value: tokenA,
        url: new URL(page2.url()).origin,
      },
    ]);
    await openSales(page2);
    await expect.poll(() => outboxCount(page2), SERVER).toBe(0);
    expect(await serverSales(api, colaName)).toBe(6);
    expect(await stockOf(api, cola)).toBe(4);
  });
});
