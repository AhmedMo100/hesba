import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * QA-57 and the platform UX pass on the real app: the Hesba logo and the shop menu (theme
 * moved there), six screens around «البيع», the shop name when the session cannot be loaded
 * (offline), the stock form reading the product's unit, and «ليك» with products.
 *
 * Needs a server whose database is safe to write to (each test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };
const SERVER = { timeout: 30_000 };

async function signup(api: APIRequestContext, storeName: string) {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "أحمد",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `ux-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Platform-ux-2026",
      storeName,
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
      operatingMode: "pos",
    },
  });
  expect(res.ok()).toBe(true);
}

async function product(
  api: APIRequestContext,
  nameAr: string,
  opts: { price: number; stock: number; unit?: string; packQty?: number },
) {
  const res = await api.post("/api/products", {
    data: {
      nameAr,
      category: "بقالة",
      unit: opts.unit ?? "piece",
      sellPricePiasters: opts.price,
      isCustom: true,
      variants: [{ packQty: opts.packQty ?? 1, sellPricePiasters: opts.price }],
    },
  });
  expect(res.ok()).toBe(true);
  const variantId: string = (await res.json()).data.variants[0].id;
  if (opts.stock > 0) {
    const add = await api.post("/api/stock", {
      data: {
        action: "add",
        storeVariantId: variantId,
        quantityBase: opts.stock,
        costPricePiasters: 500,
      },
    });
    expect(add.ok()).toBe(true);
  }
  return variantId;
}

async function open(page: Page, path: string, testId: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", ...PAGE_LOAD });
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId(testId)).toBeVisible(PAGE_LOAD);
}

test("header (V19): title and shop name, theme button, no bell; shop menu keeps theme/sync/logout", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = Math.random().toString(36).slice(2, 6);
  await signup(page.request, `سوبر ماركت ${run}`);
  await open(page, "/app", "page-home");

  const header = page.locator("header");
  await expect(header.getByTestId("store-name")).toHaveText(
    `سوبر ماركت ${run}`,
    SERVER,
  );
  await expect(header.getByRole("button", { name: /الوضع/ })).toBeVisible();
  await expect(
    header.getByRole("button", { name: /جرس التنبيهات/ }),
  ).toHaveCount(0);
  // Home has no back arrow; an inner page does, and it goes home.
  await expect(
    header.getByRole("button", { name: "رجوع للرئيسية" }),
  ).toHaveCount(0);

  await header.getByTestId("store-button").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(`سوبر ماركت ${run}`);
  await expect(menu).toContainText("أحمد · متصل");
  await expect(menu).toContainText("بيانات الحساب والمحل");
  await expect(menu).toContainText("كل حاجة تمام ✓");
  await expect(menu).toContainText("تسجيل الخروج");
  await menu.getByRole("tab", { name: "غامق" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await menu.getByRole("tab", { name: "فاتح" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("navigation: no bottom bar; the home tiles open every screen and the back arrow returns home", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signup(page.request, "محل التنقل");
  await open(page, "/app", "page-home");
  await expect(page.locator('[data-testid^="bnav-"]')).toHaveCount(0);
  await expect(page.getByTestId("home-tile-alerts")).toHaveCount(0);
  // No sidebar either; Home has exactly the eight actions in the owner's order (ADR-0036).
  await expect(page.locator('[data-testid^="snav-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="home-tile-"]')).toHaveCount(8);
  for (const [testId, screen] of [
    ["home-tile-stock", "page-stock"],
    ["home-tile-expenses", "page-expenses"],
    ["home-tile-sales", "page-sales"],
    ["home-tile-people", "page-people"],
    ["home-tile-products", "page-products"],
    ["home-tile-services", "page-services"],
    ["home-tile-ai", "page-ai"],
    ["home-tile-stocktake", "page-stocktake"],
    // The two numbers and the alerts line open their screens.
    ["home-money", "page-money"],
    ["home-profit", "page-reports"],
    ["home-alerts", "page-notifications"],
  ] as const) {
    await page.getByTestId(testId).click();
    await expect(page.getByTestId(screen)).toBeVisible(PAGE_LOAD);
    await page.getByRole("button", { name: "رجوع للرئيسية" }).click();
    await expect(page.getByTestId("page-home")).toBeVisible(PAGE_LOAD);
  }
});

test("QA-57: the shop name stays in the header when the session cannot be loaded (offline)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const run = Math.random().toString(36).slice(2, 6);
  await signup(page.request, `بقالة الأوفلاين ${run}`);
  await open(page, "/app", "page-home");
  await expect(page.getByTestId("store-name")).toHaveText(
    `بقالة الأوفلاين ${run}`,
    SERVER,
  );

  // The session request fails like it does without a network: no answer at all.
  const sessionCalls: string[] = [];
  await page.route("**/api/auth/session", (route) => {
    sessionCalls.push(route.request().url());
    return route.abort("internetdisconnected");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("store-name")).toHaveText(
    `بقالة الأوفلاين ${run}`,
    PAGE_LOAD,
  );
  await expect(page.getByTestId("store-name")).not.toHaveText("حسبة");
  expect(sessionCalls.length).toBeGreaterThan(0);
});

test("stock form: the quantity follows the product's unit; reports have the six period filters", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signup(page.request, "محل المخزون");
  const run = Math.random().toString(36).slice(2, 6);
  await product(page.request, `مكرونة ${run}`, {
    price: 1500,
    stock: 40,
    unit: "bag",
    packQty: 20,
  });
  await open(page, "/app/stock", "page-stock");
  await page.getByTestId("stock-manual-btn").click();
  const sheet = page.getByRole("dialog").last();
  await sheet.getByRole("button", { name: /اختار المنتج/ }).click();
  await sheet
    .getByRole("button", { name: new RegExp(`مكرونة ${run}`) })
    .click();
  await sheet.getByRole("button", { name: /كمّل/ }).click();
  // Bags sold in packs of 20: packs and loose bags, a pack price and a bag price.
  const entry = page.getByTestId("stock-entry").last();
  await expect(page.getByTestId("stock-qty-label").last()).toHaveText(
    "عدد العبوات",
    SERVER,
  );
  await expect(entry).toContainText("أكياس زيادة");
  await expect(entry.getByTestId("stock-pack-relation")).toContainText(
    "العبوة = 20 كيس",
  );
  await expect(page.getByTestId("stock-cost-label").last()).toContainText(
    "العبوة",
  );
  await expect(entry).toContainText("سعر شراء الكيس");
  await page.keyboard.press("Escape");

  await open(page, "/app/reports", "page-reports");
  // الكاشير الذكي reads days only (ADR-0036): today, yesterday, or a chosen day.
  for (const p of ["today", "yesterday", "day"]) {
    await expect(page.getByTestId(`report-period-${p}`)).toBeVisible();
  }
  await expect(page.getByTestId("report-period-month")).toHaveCount(0);
  await page.getByTestId("report-period-day").click();
  await expect(page.getByTestId("report-day")).toBeVisible();
  await page.getByTestId("report-period-today").click();
  await expect(page.getByTestId("report-additions")).toContainText(
    `مكرونة ${run}`,
    SERVER,
  );
});

test("«ليك» with products: stock is taken and the customer owes the invoice", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api, "محل الآجل");
  const run = Math.random().toString(36).slice(2, 6);
  const tea = await product(api, `شاي ليك ${run}`, {
    price: 1000,
    stock: 30,
    packQty: 10,
  });
  const person = await api.post("/api/people", {
    data: { name: `زبون ليك ${run}`, section: "owedToMe", amountEgp: "0" },
  });
  expect(person.status()).toBe(201);
  const customerId = (await person.json()).person.id as string;

  await open(page, "/app/people", "page-people");
  await page.getByTestId(`person-row-${customerId}`).click();
  await page.getByTestId(`customer-debt-${customerId}`).last().click();
  // الكاشير الذكي: the manual debt sheet offers the credit invoice (stock taken) — ADR-0036.
  await page.getByRole("dialog").getByTestId("debt-open-invoice").click();
  const sheet = page.getByRole("dialog").getByTestId("customer-debt-sheet");
  await expect(sheet.getByTestId("lines-search")).toBeVisible();
  await sheet.getByTestId("lines-search").fill(`شاي ليك ${run}`);
  await sheet.getByTestId(`lines-option-${tea}`).click();
  const row = sheet.getByTestId(`lines-row-${tea}`);
  await row.getByTestId("lines-packs").fill("2");
  await row.getByTestId("lines-units").fill("1");
  await expect(sheet.getByTestId("debt-estimate")).toContainText("210");
  await page.getByRole("dialog").getByTestId("debt-submit").click();
  // One sheet at a time: the person's sheet is opened again to read the balance.
  await expect(page.getByTestId("customer-debt-sheet")).toHaveCount(0, SERVER);
  await page.getByTestId(`person-row-${customerId}`).click();
  await expect(
    page.getByTestId(`person-balance-${customerId}`).last(),
  ).toContainText("210", SERVER);

  const inv = (await (await api.get("/api/stock")).json()).inventory as Array<{
    variantId: string;
    currentStockBase: number;
  }>;
  expect(inv.find((i) => i.variantId === tea)!.currentStockBase).toBe(30 - 21);
  const p = (await (await api.get(`/api/people/${customerId}`)).json()).person;
  expect(p.amount_piasters).toBe(21000);
});

test("P4: record a loss from Stock; Home shows it under «التالف / الفاقد»; no «آجل» on cards; mic stays in the search box", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api, "محل التالف");
  const run = Math.random().toString(36).slice(2, 6);
  const juice = await product(api, `عصير تالف ${run}`, {
    price: 1500,
    stock: 12,
  });

  await open(page, "/app/products", "page-products");
  await page
    .locator('[data-testid^="product-card-"]')
    .filter({ hasText: `عصير تالف ${run}` })
    .click();
  await page
    .getByTestId("product-sheet")
    .last()
    .locator('[data-testid^="record-loss-"]')
    .click();
  const form = page.getByRole("dialog").getByTestId("record-loss");
  await form.getByTestId("loss-reason-damaged").click();
  await form.getByTestId("loss-units").fill("2");
  await page.getByRole("dialog").getByTestId("loss-submit").click();
  await expect
    .poll(
      async () =>
        (
          (await (await api.get("/api/stock")).json()).inventory as Array<{
            variantId: string;
            currentStockBase: number;
          }>
        ).find((i) => i.variantId === juice)?.currentStockBase,
      SERVER,
    )
    .toBe(10);

  await open(page, "/app/reports", "page-reports");
  const losses = page.getByTestId("home-losses");
  await expect(losses).toContainText(`عصير تالف ${run}`, SERVER);
  await expect(losses).toContainText("تالف");

  // The stocktake search: the mic is inside the search box, not under Export.
  await open(page, "/app/inventory", "page-inventory");
  const mic = page.getByRole("button", { name: "بحث بالصوت" }).first();
  const box = await mic.evaluate((el) => {
    const sb = el.parentElement!.getBoundingClientRect();
    const m = el.getBoundingClientRect();
    return (
      m.left >= sb.left - 1 &&
      m.right <= sb.right + 1 &&
      m.top >= sb.top - 1 &&
      m.bottom <= sb.bottom + 1
    );
  });
  expect(box).toBe(true);

  // Sales cards: no «آجل» on any card.
  await open(page, "/app/sales", "page-sales");
  await expect(page.getByTestId("tile-credit")).toHaveCount(0);
  await expect(page.getByTestId("credit-start")).toBeVisible();
});
