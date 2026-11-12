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

test("header: logo, shop menu with theme/sync/logout; no theme button in the bar", async ({
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
  await expect(header.locator('img[src="/logo.png"]')).toBeVisible();
  await expect(header.getByRole("button", { name: /المظهر/ })).toHaveCount(0);
  await expect(
    header.getByRole("button", { name: /جرس التنبيهات/ }),
  ).toBeVisible();

  await header.getByTestId("store-button").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText(`سوبر ماركت ${run}`);
  await expect(menu).toContainText("أحمد · متصل");
  await expect(menu).toContainText("بيانات الحساب والمحل");
  await expect(menu).toContainText("كله متزامن ✓");
  await expect(menu).toContainText("تسجيل الخروج");
  await menu.getByRole("tab", { name: "غامق" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await menu.getByRole("tab", { name: "فاتح" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("bottom navigation: six screens around «البيع», alerts from the bell", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) >= 900,
    "the bottom navigation is the phone layout",
  );
  test.setTimeout(180_000);
  await signup(page.request, "محل التنقل");
  await open(page, "/app", "page-home");
  const nav = page.locator("nav[aria-label]").last();
  // Icons only: the names are the accessible labels (and tooltips), no visible text.
  const labels = await nav
    .locator("button")
    .evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  expect(labels).toEqual([
    "الرئيسية",
    "المنتجات",
    "المخزون",
    "البيع",
    "المصاريف",
    "الناس",
    "المساعد",
  ]);
  expect((await nav.innerText()).trim()).toBe("");
  // RTL: الرئيسية on the right, المساعد on the left, البيع in the middle.
  const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
  const home = await box("bnav-home");
  const sales = await box("bnav-sales");
  const ai = await box("bnav-ai");
  expect(home.x).toBeGreaterThan(sales.x);
  expect(sales.x).toBeGreaterThan(ai.x);
  const width = page.viewportSize()!.width;
  expect(Math.abs(sales.x + sales.width / 2 - width / 2)).toBeLessThan(4);
  await expect(nav.getByRole("button", { name: "المزيد" })).toHaveCount(0);

  for (const [id, screen] of [
    ["bnav-expenses", "page-expenses"],
    ["bnav-people", "page-people"],
    ["bnav-ai", "page-ai"],
    ["bnav-stock", "page-stock"],
  ] as const) {
    await page.getByTestId(id).click();
    await expect(page.getByTestId(screen)).toBeVisible(PAGE_LOAD);
  }
  await page.locator('header button[aria-label^="جرس التنبيهات"]').click();
  await expect(page.getByTestId("page-alerts")).toBeVisible(PAGE_LOAD);
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

test("stock form: the unit comes from the product; history has the six period filters", async ({
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
  await page.getByRole("button", { name: `مكرونة ${run}` }).click();
  await page.getByRole("button", { name: /إضافة بضاعة جديدة/ }).click();
  const unit = page.getByRole("dialog").getByTestId("stock-unit");
  await expect(unit).toContainText("بـكيس");
  await expect(unit).toContainText("الكرتونة 20 كيس");
  await expect(page.getByText("طريقة البيع")).toHaveCount(0);
  await expect(page.getByText("تصفير")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "سجل الإضافات" }).click();
  for (const label of [
    "اليوم",
    "امبارح",
    "الأسبوع",
    "الشهر",
    "السنة",
    "فترة مخصصة",
  ]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }
  await page.getByTestId("period-custom").click();
  await expect(page.getByTestId("period-from")).toBeVisible();
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
  await page.getByTestId(`customer-debt-${customerId}`).click();
  const sheet = page.getByRole("dialog").getByTestId("customer-debt-sheet");
  await sheet.getByTestId("debt-with-products").click();
  await sheet.getByTestId("lines-search").fill(`شاي ليك ${run}`);
  await sheet.getByTestId(`lines-option-${tea}`).click();
  const row = sheet.getByTestId(`lines-row-${tea}`);
  await row.getByTestId("lines-packs").fill("2");
  await row.getByTestId("lines-units").fill("1");
  await expect(sheet.getByTestId("debt-estimate")).toContainText("210");
  await page.getByRole("dialog").getByTestId("debt-submit").click();
  await expect(page.getByTestId(`person-balance-${customerId}`)).toContainText(
    "210",
    SERVER,
  );

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

  await open(page, "/app/stock", "page-stock");
  await page.getByTestId(`stock-row-${juice}`).click();
  await page.getByRole("dialog").getByTestId("stock-action-loss").click();
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

  await open(page, "/app", "page-home");
  await page.getByRole("tab", { name: /التقرير/ }).click();
  const losses = page.getByTestId("home-losses");
  await expect(losses).toContainText(`عصير تالف ${run}`, SERVER);
  await expect(losses).toContainText("تالف");

  // The stocktake search: the mic is inside the search box, not under Export.
  await page.getByRole("tab", { name: /الجرد/ }).click();
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
