import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * QA-30 / QA-31 (ADR-0027) on the real screens: a supplier purchase (create with a partial
 * payment, pay the rest, cancel), a cart invoice with a discount and a card payment, and a
 * credit sale that is collected and partly returned. The server's answers are checked through
 * the API after each step.
 *
 * Needs a server whose database is safe to write to (the test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };
const SERVER = { timeout: 30_000 };

async function signup(api: APIRequestContext) {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل فواتير",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `inv-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Invoices-e2e-2026-ok",
      storeName: "محل فواتير",
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(res.ok()).toBe(true);
}

async function product(
  api: APIRequestContext,
  nameAr: string,
  price: number,
  stock: number,
) {
  const res = await api.post("/api/products", {
    data: {
      nameAr,
      category: "مشروبات",
      unit: "piece",
      sellPricePiasters: price,
      isCustom: true,
      variants: [{ packQty: 1, sellPricePiasters: price }],
    },
  });
  expect(res.ok()).toBe(true);
  const variantId: string = (await res.json()).data.variants[0].id;
  if (stock > 0) {
    const add = await api.post("/api/stock", {
      data: {
        action: "add",
        storeVariantId: variantId,
        quantityBase: stock,
        costPricePiasters: 100 * stock,
      },
    });
    expect(add.ok()).toBe(true);
  }
  return variantId;
}

async function person(
  api: APIRequestContext,
  name: string,
  section: "owedToMe" | "suppliers",
) {
  const res = await api.post("/api/people", {
    data: { name, section, amountEgp: "0" },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).person.id as string;
}

const stockOf = async (api: APIRequestContext, variantId: string) =>
  (
    (await (await api.get("/api/stock")).json()).inventory as Array<{
      variantId: string;
      currentStockBase: number;
    }>
  ).find((i) => i.variantId === variantId)?.currentStockBase;

async function open(page: Page, path: string, testId: string) {
  await page.goto(path);
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId(testId)).toBeVisible(PAGE_LOAD);
}

test("supplier purchase: create with a partial payment, pay the rest, cancel another", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const cola = await product(api, `كولا شراء ${run}`, 1000, 0);
  const supplier = await person(api, `مورد ${run}`, "suppliers");

  await open(page, "/app/people", "page-people");
  await page
    .getByRole("tab", { name: /الموردين/ })
    .first()
    .click();
  await page.getByTestId(`supplier-purchases-${supplier}`).click();
  // The real sheet lives in the People view (a closing Modal leaves a short-lived ghost copy).
  const sheet = page.getByTestId("page-people");
  await expect(sheet.getByTestId("purchases-sheet")).toBeVisible();
  await sheet.getByTestId("purchase-new").click();
  await sheet.getByTestId("purchase-line-item").selectOption(cola);
  await sheet.getByTestId("purchase-line-qty").fill("24");
  await sheet.getByTestId("purchase-line-cost").fill("168");
  await sheet.getByTestId("purchase-paid-now").fill("100");
  await sheet.getByTestId("purchase-save").click();
  await expect(sheet.getByTestId("purchase-row")).toHaveCount(1, SERVER);
  await expect(sheet.getByTestId("purchase-outstanding").first()).toHaveText(
    "68 ج.م",
  );
  expect(await stockOf(api, cola)).toBe(24);
  const sup = await (await api.get(`/api/people/${supplier}`)).json();
  expect(sup.person.amount_piasters).toBe(6800);

  await sheet.getByTestId("purchase-pay-amount").first().fill("68");
  await sheet.getByTestId("purchase-pay").first().click();
  await expect(sheet.getByTestId("purchase-outstanding").first()).toHaveText(
    "0 ج.م",
    SERVER,
  );
  expect(
    (await (await api.get(`/api/people/${supplier}`)).json()).person
      .amount_piasters,
  ).toBe(0);

  // A second invoice, cancelled from the sheet: stock out, debt reversed.
  await sheet.getByTestId("purchase-new").click();
  await sheet.getByTestId("purchase-line-item").selectOption(cola);
  await sheet.getByTestId("purchase-line-qty").fill("6");
  await sheet.getByTestId("purchase-line-cost").fill("42");
  await sheet.getByTestId("purchase-save").click();
  await expect(sheet.getByTestId("purchase-row")).toHaveCount(2, SERVER);
  expect(await stockOf(api, cola)).toBe(30);
  page.once("dialog", (d) => void d.accept());
  await sheet.getByTestId("purchase-cancel").first().click();
  await expect(
    sheet.locator('[data-testid="purchase-row"][data-voided="true"]'),
  ).toHaveCount(1, SERVER);
  expect(await stockOf(api, cola)).toBe(24);
  expect(
    (await (await api.get(`/api/people/${supplier}`)).json()).person
      .amount_piasters,
  ).toBe(0);
});

test("cart: several items, a discount and a card payment, priced by the server", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const tea = await product(api, `شاي سلة ${run}`, 1250, 10);
  const chips = await product(api, `شيبسي سلة ${run}`, 500, 10);

  await open(page, "/app/sales", "page-sales");
  await page.getByTestId("page-sales").getByTestId("cart-toggle").click();
  await page.getByRole("button", { name: `بيع شاي سلة ${run}` }).click();
  await page.getByRole("button", { name: `بيع شاي سلة ${run}` }).click();
  await page.getByRole("button", { name: `بيع شيبسي سلة ${run}` }).click();
  // The invoice opens from its small summary (no big cart block on the screen).
  await page.getByTestId("page-sales").getByTestId("cart-summary").click();
  await expect(
    page.getByTestId("page-sales").getByTestId("cart-line"),
  ).toHaveCount(2);
  await page.getByTestId("page-sales").getByTestId("cart-discount").fill("5");
  await page
    .getByTestId("page-sales")
    .getByTestId("cart-sheet")
    .getByRole("tab", { name: "فيزا" })
    .click();
  await expect(
    page.getByTestId("page-sales").getByTestId("cart-total"),
  ).toHaveText("25 ج.م");
  await page.getByTestId("page-sales").getByTestId("cart-checkout").click();
  await expect(
    page.getByTestId("page-sales").getByTestId("cart-sheet"),
  ).toHaveCount(0, SERVER);
  expect(await stockOf(api, tea)).toBe(8);
  expect(await stockOf(api, chips)).toBe(9);
  const sales = (await (await api.get("/api/sales")).json()).sales as Array<{
    amountPiasters: number;
    paymentMethod: string;
    discountPiasters: number;
    lineCount: number;
  }>;
  expect(sales[0]).toMatchObject({
    amountPiasters: 2500,
    paymentMethod: "card",
    discountPiasters: 500,
    lineCount: 2,
  });
});

test("credit sale: invoice on the customer, collected from the invoice, then partly returned", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const rice = await product(api, `رز آجل ${run}`, 2000, 10);
  const customer = await person(api, `زبون ${run}`, "owedToMe");

  await open(page, "/app/sales", "page-sales");
  await page.getByTestId("page-sales").getByTestId("cart-toggle").click();
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: `بيع رز آجل ${run}` }).click();
  await page.getByTestId("page-sales").getByTestId("cart-summary").click();
  await page
    .getByTestId("page-sales")
    .getByTestId("cart-sheet")
    .getByRole("tab", { name: "آجل" })
    .click();
  await page
    .getByTestId("page-sales")
    .getByTestId("cart-customer")
    .selectOption(customer);
  await page.getByTestId("page-sales").getByTestId("cart-paid-now").fill("10");
  await page.getByTestId("page-sales").getByTestId("cart-checkout").click();
  await expect(
    page.getByTestId("page-sales").getByTestId("cart-sheet"),
  ).toHaveCount(0, SERVER);
  expect(
    (await (await api.get(`/api/people/${customer}`)).json()).person
      .amount_piasters,
  ).toBe(5000);

  await page.getByTestId("sale-details").first().click();
  await expect(page.getByTestId("invoice-outstanding")).toHaveText(
    "50 ج.م",
    SERVER,
  );
  await page.getByTestId("invoice-collect-amount").fill("20");
  await page.getByTestId("invoice-collect-submit").click();
  await expect(page.getByTestId("invoice-outstanding")).toHaveText(
    "30 ج.م",
    SERVER,
  );

  await page.getByTestId("invoice-return-qty").first().fill("1");
  await page.getByTestId("invoice-return-submit").click();
  await expect(page.getByTestId("invoice-returned")).toHaveText(
    "20 ج.م",
    SERVER,
  );
  await expect(page.getByTestId("invoice-outstanding")).toHaveText("10 ج.م");
  expect(await stockOf(api, rice)).toBe(8);
  expect(
    (await (await api.get(`/api/people/${customer}`)).json()).person
      .amount_piasters,
  ).toBe(1000);
});
