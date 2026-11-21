import postgres from "postgres";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * On the real app (a server on a safe local database, AI on the local mock — no key, nothing
 * leaves the machine): the sale screen's barcode scanner (no AI, no quota) fills the same
 * invoice for a cash or a credit sale; «ليك» shows the customer's invoices and collects one;
 * the assistant page; the platform admin page (admin vs shop owner).
 */

const PAGE_LOAD = { timeout: 60_000 };
const SERVER = { timeout: 30_000 };

async function signup(api: APIRequestContext, storeName: string) {
  const email = `p5-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`;
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "أحمد",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email,
      password: "Prompt-two-2026",
      storeName,
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
      operatingMode: "pos",
    },
  });
  expect(res.ok()).toBe(true);
  return email;
}

async function product(
  api: APIRequestContext,
  nameAr: string,
  opts: { price: number; stock: number; unit?: string; barcode?: string },
) {
  const res = await api.post("/api/products", {
    data: {
      nameAr,
      category: "مشروبات",
      unit: opts.unit ?? "piece",
      sellPricePiasters: opts.price,
      isCustom: true,
      barcode: opts.barcode ?? null,
      variants: [
        {
          packQty: 1,
          sellPricePiasters: opts.price,
          barcode: opts.barcode ?? null,
        },
      ],
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

async function open(page: Page, url: string, testId: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", ...PAGE_LOAD });
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId(testId)).toBeVisible(PAGE_LOAD);
}

const stockOf = async (api: APIRequestContext, variantId: string) =>
  (
    (await (await api.get("/api/stock")).json()).inventory as Array<{
      variantId: string;
      currentStockBase: number;
    }>
  ).find((i) => i.variantId === variantId)?.currentStockBase;

/**
 * The barcode scanner (no AI): the camera opens with the sheet (Chromium's fake camera here);
 * a code — read by the camera or typed by a physical scanner — shows ✓ and the product, «تم»
 * opens the usual sell sheet, which adds it to the open invoice.
 */
async function scanToInvoice(
  page: Page,
  code: string,
  name: string,
  qty: string,
) {
  const aiCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/ai/scan")) aiCalls.push(r.url());
  });
  await page.getByTestId("page-sales").getByTestId("sales-scan").click();
  await expect(page.getByTestId("barcode-scan-sheet")).toHaveCount(1);
  await page.waitForTimeout(800);
  // A physical scanner: fast keystrokes ending with Enter.
  await page.keyboard.type(code, { delay: 10 });
  await page.keyboard.press("Enter");
  const hit = page.getByTestId("scan-hit").last();
  await expect(hit).toContainText(name, SERVER);
  await hit.getByTestId("scan-done").click();
  await expect(page.getByTestId("sell-sheet")).toHaveCount(1, SERVER);
  const sheet = page.getByTestId("sell-sheet").last();
  await sheet.getByTestId("sell-qty").fill(qty);
  await sheet.getByTestId("sell-confirm").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(aiCalls).toEqual([]);
}

// The scanner sheet opens the camera: Chromium's fake device, allowed without a prompt.
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("barcode scanner → invoice: ✓ the product, «تم», checkout takes the stock once (no AI)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api, "محل الاسكان");
  const run = Math.random().toString(36).slice(2, 6);
  const pepsi = await product(api, `بيبسي كانز 330 مل ${run}`, {
    price: 1500,
    stock: 24,
    barcode: `62210${run}01`,
  });
  const chips = await product(api, `شيبسي جبنة ${run}`, {
    price: 1000,
    stock: 5,
    barcode: `62210${run}02`,
  });
  await product(api, `بيبسي 1 لتر ${run}`, { price: 3000, stock: 6 });

  await open(page, "/app/sales", "page-sales");
  await page.getByTestId("page-sales").getByTestId("cart-toggle").click();
  await scanToInvoice(page, `62210${run}01`, `بيبسي كانز 330 مل ${run}`, "3");
  await scanToInvoice(page, `62210${run}02`, `شيبسي جبنة ${run}`, "1");

  await page.getByTestId("page-sales").getByTestId("cart-summary").click();
  const cart = page.getByRole("dialog").last().getByTestId("cart-sheet");
  await expect(cart.getByTestId("cart-line")).toHaveCount(2, SERVER);
  // 3 × 15 + 1 × 10 = 55 EGP, priced by the shop's own prices.
  await expect(cart.getByTestId("cart-total")).toContainText("55", SERVER);
  await page.getByRole("dialog").last().getByTestId("cart-checkout").click();
  await expect.poll(() => stockOf(api, pepsi), SERVER).toBe(21);
  expect(await stockOf(api, chips)).toBe(4);
  // Scanning recorded nothing by itself: exactly one sale.
  const sales = (await (await api.get("/api/sales")).json()).sales as unknown[];
  expect(sales).toHaveLength(1);
});

test("barcode scanner → credit sale; «ليك» shows the invoice with its products and collects part of it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const api = page.request;
  await signup(api, "محل اسكان آجل");
  const run = Math.random().toString(36).slice(2, 6);
  const pepsi = await product(api, `بيبسي كانز 330 مل ${run}`, {
    price: 1500,
    stock: 24,
    barcode: `62211${run}01`,
  });
  await product(api, `شيبسي جبنة ${run}`, { price: 1000, stock: 5 });

  await open(page, "/app/sales", "page-sales");
  const screen = page.getByTestId("page-sales");
  // «آجل», scan, then the customer is typed in the invoice before confirming.
  await screen.getByTestId("credit-start").click();
  await scanToInvoice(page, `62211${run}01`, `بيبسي كانز 330 مل ${run}`, "3");

  await screen.getByTestId("cart-summary").click();
  const cart = page.getByRole("dialog").last().getByTestId("cart-sheet");
  await cart.getByTestId("credit-name").fill(`زبون الاسكان ${run}`);
  await expect(cart.getByTestId("cart-total")).toContainText("45", SERVER);
  await cart.getByTestId("cart-paid-now").fill("10");
  await page.getByRole("dialog").last().getByTestId("cart-checkout").click();
  await expect.poll(() => stockOf(api, pepsi), SERVER).toBe(21);

  const people = (await (
    await api.get("/api/people?section=owedToMe")
  ).json()) as {
    people?: Array<{ id: string; name: string; amount_piasters: number }>;
  };
  const customer = (people.people ?? []).find((p) =>
    p.name.includes(`زبون الاسكان ${run}`),
  )!;
  expect(customer.amount_piasters).toBe(3500);

  await open(page, "/app/people", "page-people");
  await page.getByTestId(`person-row-${customer.id}`).click();
  await page.getByTestId(`customer-invoices-${customer.id}`).last().click();
  const sheet = page.getByRole("dialog").getByTestId("customer-invoices");
  await expect(sheet.getByTestId("customer-outstanding")).toContainText(
    "35",
    SERVER,
  );
  const invoice = sheet.locator('[data-testid^="customer-invoice-"]').first();
  await expect(invoice).toContainText(`بيبسي كانز 330 مل ${run}`);
  await expect(invoice).toContainText("3 قطعة");
  await expect(invoice.getByTestId("invoice-remaining")).toContainText("35");
  await invoice.getByTestId("invoice-pay-amount").fill("20");
  await invoice.getByTestId("invoice-pay").click();
  await expect(sheet.getByTestId("customer-outstanding")).toContainText(
    "15",
    SERVER,
  );
  await expect(invoice.getByTestId("invoice-remaining")).toContainText("15");
  // Still one sale for that customer: collecting never sells again.
  const sales = (await (await api.get("/api/sales")).json()).sales as unknown[];
  expect(sales).toHaveLength(1);
});
test("assistant: suggestions, a growing input, an answer, and offline keeps the question", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await signup(page.request, "محل المساعد");
  await open(page, "/app/ai", "page-ai");
  await expect(page.getByTestId("ai-empty-suggestions")).toBeVisible();
  await expect(page.getByTestId("ai-new-chat")).toBeVisible();
  await expect(page.getByTestId("ai-history")).toBeVisible();
  const input = page.getByTestId("ai-input");
  await expect(input).toHaveJSProperty("tagName", "TEXTAREA");
  await input.fill("كسبت كام النهارده؟");
  await page.getByRole("button", { name: "إرسال" }).click();
  await expect(page.getByTestId("ai-msg-bot").last()).not.toBeEmpty(SERVER);
  // V17 shows no quota badge; the server still counts the question (4 of 5 left).
  await expect
    .poll(async () => {
      const q = await (await page.request.get("/api/ai/quota")).json();
      return (q.data ?? q).remaining;
    }, SERVER)
    .toBe(4);

  await context.setOffline(true);
  await input.fill("مصروفاتي الشهر ده كام؟");
  await page.getByRole("button", { name: "إرسال" }).click();
  await expect(page.getByText("مفيش نت دلوقتي")).toBeVisible();
  await expect(input).toHaveValue("مصروفاتي الشهر ده كام؟");
  await context.setOffline(false);
});

test("platform admin: a shop owner is refused; an admin sees usage and changes a shop's scanner quota", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const adminUrl = process.env["HESBA_TEST_ADMIN_URL"];
  test.skip(
    !adminUrl,
    "needs the local test database to list an admin (staff SQL step)",
  );

  // A shop owner.
  const ownerPage = await (
    await browser.newContext({ baseURL: test.info().project.use.baseURL })
  ).newPage();
  await signup(ownerPage.request, "محل عادي");
  await ownerPage.goto("/admin", {
    waitUntil: "domcontentloaded",
    ...PAGE_LOAD,
  });
  await expect(ownerPage.getByTestId("admin-denied")).toBeVisible(PAGE_LOAD);
  expect((await ownerPage.request.get("/api/admin/ai")).status()).toBe(403);
  const ownerStore =
    (
      (await (await ownerPage.request.get("/api/auth/session")).json()) as {
        data?: { store?: { id: string } };
      }
    ).data ?? {};

  // The admin (listed by staff SQL on the local test database).
  const email = await signup(page.request, "إدارة حسبة");
  const sql = postgres(adminUrl!, { max: 1 });
  try {
    await sql`INSERT INTO platform_admins (user_id, note) SELECT id, 'e2e' FROM users WHERE email = ${email}`;
    await open(page, "/admin", "admin-ai");
    await expect(page.getByTestId("admin-today-total")).toBeVisible();
    const storeId = ownerStore.store?.id ?? "";
    expect(storeId).toBeTruthy();
    {
      await page.getByTestId("admin-shop-search").fill(storeId);
      await page.getByRole("button", { name: "دوّر" }).click();
      const row = page.getByTestId(`admin-shop-${storeId}`);
      await row.getByTestId("admin-shop-edit").click();
      await row.getByTestId("admin-shop-daily").fill("2");
      await row.getByTestId("admin-shop-grant").fill("5");
      await row.getByTestId("admin-shop-save").click();
      await expect(page.getByTestId(`admin-shop-${storeId}`)).toContainText(
        "/2",
        SERVER,
      );
      await expect(page.getByTestId(`admin-shop-${storeId}`)).toContainText(
        "رصيد إضافي 5",
      );
      // The shop sees its new limit at once.
      const q = await (
        await ownerPage.request.get("/api/ai/scan/quota")
      ).json();
      expect(q).toMatchObject({ dailyLimit: 2, bonusCredits: 5 });
      await expect(page.getByTestId("admin-audit")).toContainText(
        "shop_quota_update_and_grant",
        SERVER,
      );
    }
  } finally {
    await sql`DELETE FROM platform_admins WHERE user_id IN (SELECT id FROM users WHERE email = ${email})`;
    await sql.end();
  }
});
