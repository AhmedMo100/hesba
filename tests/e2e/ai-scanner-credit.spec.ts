import postgres from "postgres";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Prompt 2 on the real app (a server on a safe local database, AI on the local mock — no key,
 * nothing leaves the machine): the AI product scanner fills the same cart for a cash or a
 * credit sale; «ليك» shows the customer's invoices and collects one; the assistant page; the
 * platform admin page (admin vs shop owner).
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
    },
  });
  expect(res.ok()).toBe(true);
  return email;
}

async function product(
  api: APIRequestContext,
  nameAr: string,
  opts: { price: number; stock: number; unit?: string },
) {
  const res = await api.post("/api/products", {
    data: {
      nameAr,
      category: "مشروبات",
      unit: opts.unit ?? "piece",
      sellPricePiasters: opts.price,
      isCustom: true,
      variants: [{ packQty: 1, sellPricePiasters: opts.price }],
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
 * Live scanner (ADR-0030): the camera opens with the sheet (Chromium's fake camera here) and
 * changing frames are sent to the vision model (the server's mock: Pepsi 330 ml ×2 sure,
 * Chipsy cheese unsure, one unreadable item). «إنهاء» → review → confirm into the invoice.
 */
async function scanAndConfirm(page: Page, opts: { chooseChips: boolean }) {
  await page.getByTestId("page-sales").getByTestId("sales-scan").click();
  const dialog = () => page.getByRole("dialog").last();
  const sheet = () => dialog().getByTestId("product-scanner");
  // No mode screen and no «open camera» button: scanning starts by itself.
  await expect(page.getByTestId("scan-mode-select")).toHaveCount(0);
  await expect(sheet().locator('[data-status="matched"]').first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    sheet().locator('[data-status="uncertain"]').first(),
  ).toBeVisible(SERVER);
  await dialog().getByTestId("scan-finish").click();

  // Nothing can be added while a line is undecided.
  await expect(dialog().getByTestId("scan-confirm")).toBeDisabled();
  const unclear = sheet().locator('[data-status="unmatched"]');
  while ((await unclear.count()) > 0) {
    await unclear.first().getByTestId("scan-remove").click();
  }
  const unsure = sheet().locator('[data-status="uncertain"]');
  if (opts.chooseChips) {
    await unsure.first().getByTestId("scan-candidate").first().check();
    while ((await unsure.count()) > 1) {
      await unsure.last().getByTestId("scan-remove").click();
    }
  } else {
    while ((await unsure.count()) > 0) {
      await unsure.first().getByTestId("scan-remove").click();
    }
  }
  const matched = sheet().locator('[data-status="matched"]');
  while ((await matched.count()) > 1) {
    await matched.last().getByTestId("scan-remove").click();
  }
  // Correct a quantity: 3 cans.
  await matched.first().getByTestId("scan-qty").fill("3");
  if (opts.chooseChips) await unsure.first().getByTestId("scan-qty").fill("1");
  await expect(dialog().getByTestId("scan-confirm")).toBeEnabled();
  await dialog().getByTestId("scan-confirm").click();
}

// The live scanner needs a camera: Chromium's fake device, allowed without a prompt.
test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("scanner → normal sale: confirmed lines join the cart; checkout takes the stock once", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api, "محل الاسكان");
  const run = Math.random().toString(36).slice(2, 6);
  const pepsi = await product(api, `بيبسي كانز 330 مل ${run}`, {
    price: 1500,
    stock: 24,
  });
  const chips = await product(api, `شيبسي جبنة ${run}`, {
    price: 1000,
    stock: 5,
  });
  await product(api, `بيبسي 1 لتر ${run}`, { price: 3000, stock: 6 });

  await open(page, "/app/sales", "page-sales");
  await scanAndConfirm(page, { chooseChips: true });

  const cart = page.getByRole("dialog").last().getByTestId("cart-sheet");
  await expect(cart.getByTestId("cart-line")).toHaveCount(2, SERVER);
  // 3 × 15 + 1 × 10 = 55 EGP, priced by the shop's own prices.
  await expect(cart.getByTestId("cart-total")).toContainText("55", SERVER);
  await page.getByRole("dialog").last().getByTestId("cart-checkout").click();
  await expect.poll(() => stockOf(api, pepsi), SERVER).toBe(21);
  expect(await stockOf(api, chips)).toBe(4);
  // The scan recorded nothing by itself: exactly one sale.
  const sales = (await (await api.get("/api/sales")).json()).sales as unknown[];
  expect(sales).toHaveLength(1);
});

test("scanner → credit sale; «ليك» shows the invoice with its products and collects part of it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const api = page.request;
  await signup(api, "محل اسكان آجل");
  const run = Math.random().toString(36).slice(2, 6);
  const pepsi = await product(api, `بيبسي كانز 330 مل ${run}`, {
    price: 1500,
    stock: 24,
  });
  await product(api, `شيبسي جبنة ${run}`, { price: 1000, stock: 5 });

  await open(page, "/app/sales", "page-sales");
  const screen = page.getByTestId("page-sales");
  // «بيع آجل», scan, then the customer is typed in the invoice before confirming.
  await screen.getByTestId("credit-start").click();
  await scanAndConfirm(page, { chooseChips: false });

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
  const input = page.getByTestId("ai-input");
  await expect(input).toHaveJSProperty("tagName", "TEXTAREA");
  await input.fill("كسبت كام النهارده؟");
  await page.getByRole("button", { name: "إرسال" }).click();
  await expect(page.locator('[class*="msgA"]').last()).not.toBeEmpty(SERVER);
  await expect(page.getByTestId("ai-quota-badge")).toContainText("4", SERVER);

  await context.setOffline(true);
  await input.fill("مصروفاتي الشهر ده كام؟");
  await page.getByRole("button", { name: "إرسال" }).click();
  await expect(page.getByText("مفيش نت دلوقتي")).toBeVisible();
  await expect(input).toHaveValue("مصروفاتي الشهر ده كام؟");
  await expect(page.getByTestId("ai-quota-badge")).toContainText("4");
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
