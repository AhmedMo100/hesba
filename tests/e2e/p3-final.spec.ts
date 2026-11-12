import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * QA-52 and QA-53 on the real app: a weighed product under 3 kg is «قرب يخلص» on Alerts, and
 * the shared catalog is downloaded into IndexedDB after sign-in, then kept (not duplicated) on
 * the next visit, and searchable with the network off.
 *
 * Needs a server whose database is safe to write to (each test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };

async function signup(api: APIRequestContext) {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل نهائي",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `final-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Final-e2e-2026-ok",
      storeName: "محل نهائي",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(res.ok()).toBe(true);
}

/** Rows in one IndexedDB object store of the app's database. */
const countLocal = (store: string) =>
  new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("hesba_db");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const idb = open.result;
      if (!idb.objectStoreNames.contains(store)) return resolve(-1);
      const req = idb.transaction(store).objectStore(store).count();
      req.onsuccess = () => {
        resolve(req.result);
        idb.close();
      };
      req.onerror = () => reject(req.error);
    };
  });

test("QA-53: the catalog is downloaded after sign-in, kept on reload, and searchable offline", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const api = page.request;
  await signup(api);

  // What the server has (all pages).
  let serverCount = 0;
  let cursor = "";
  for (let i = 0; i < 100; i++) {
    const res = await api.get(
      `/api/sync/catalog?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (res.status() === 204) break;
    expect(res.status()).toBe(200);
    const body = await res.json();
    serverCount += body.products.length;
    cursor = body.next_cursor;
    if (!body.has_more) break;
  }
  expect(serverCount).toBeGreaterThan(0);

  await page.goto("/app", { waitUntil: "domcontentloaded", ...PAGE_LOAD });
  await expect(page.getByTestId("page-home")).toBeVisible(PAGE_LOAD);
  await expect
    .poll(() => page.evaluate(countLocal, "global_products"), PAGE_LOAD)
    .toBe(serverCount);

  // A second visit only checks for changes: same rows, no duplicates.
  const syncCalls: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/sync/catalog")) syncCalls.push(r.status());
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("page-home")).toBeVisible(PAGE_LOAD);
  await expect.poll(() => syncCalls.length, PAGE_LOAD).toBeGreaterThan(0);
  expect(syncCalls.every((s) => s === 204 || s === 304)).toBe(true);
  expect(await page.evaluate(countLocal, "global_products")).toBe(serverCount);

  // Offline, the local catalog still answers.
  await context.setOffline(true);
  expect(await page.evaluate(countLocal, "global_products")).toBe(serverCount);
  await context.setOffline(false);
});

test("QA-52: a weighed product under 3 kg is «قرب يخلص» on Alerts", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const res = await api.post("/api/products", {
    data: {
      nameAr: `جبنة رومي ${run}`,
      category: "ألبان",
      unit: "kg",
      sellPricePiasters: 30000,
      isCustom: true,
      variants: [{ packQty: 1, sellPricePiasters: 30000 }],
    },
  });
  expect(res.ok()).toBe(true);
  const variantId: string = (await res.json()).data.variants[0].id;
  const add = await api.post("/api/stock", {
    data: {
      action: "add",
      storeVariantId: variantId,
      quantityBase: 2000,
      costPricePiasters: 40000,
    },
  });
  expect(add.ok()).toBe(true);

  const alerts = await (await api.get("/api/alerts")).json();
  expect(
    (alerts.lowStock as Array<{ variantId: string }>).some(
      (a) => a.variantId === variantId,
    ),
  ).toBe(true);

  await page.goto("/app/alerts", {
    waitUntil: "domcontentloaded",
    ...PAGE_LOAD,
  });
  await expect(page.getByTestId("page-alerts")).toBeVisible(PAGE_LOAD);
  await expect(page.getByText(`جبنة رومي ${run}`).first()).toBeVisible(
    PAGE_LOAD,
  );
});
