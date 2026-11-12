import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * The credit-sale (آجل) workflow on the real screens: the customer is chosen once (an existing
 * one by phone — never duplicated — or a new one), several products in different units go on
 * ONE invoice, «تسجيل الآجل» records it with its receivable, and the owner lands on People →
 * «ليك». A later partial payment reduces that invoice's balance. A normal tap stays a cash sale.
 *
 * Needs a server whose database is safe to write to (each test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };
const SERVER = { timeout: 30_000 };

async function signup(api: APIRequestContext) {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل آجل",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `credit-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Credit-e2e-2026-ok",
      storeName: "محل آجل",
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
  const add = await api.post("/api/stock", {
    data: {
      action: "add",
      storeVariantId: variantId,
      quantityBase: opts.stock,
      costPricePiasters: 1000,
    },
  });
  expect(add.ok()).toBe(true);
  return variantId;
}

async function open(page: Page, path: string, testId: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", ...PAGE_LOAD });
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
  ).find((i) => i.variantId === variantId)!.currentStockBase;

type Person = {
  id: string;
  name: string;
  phone: string | null;
  amount_piasters: number;
};

test("آجل: one customer, several products in pieces, packs and weight, one invoice, then a partial payment", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const tea = await product(api, `شاي آجل ${run}`, {
    price: 1250,
    stock: 30,
    packQty: 10,
  });
  const cheese = await product(api, `جبنة آجل ${run}`, {
    price: 20000,
    stock: 5000,
    unit: "kg",
  });
  const known = await api.post("/api/people", {
    data: {
      name: `زبون قديم ${run}`,
      phone: "01011112222",
      section: "owedToMe",
      amountEgp: "0",
    },
  });
  expect(known.status()).toBe(201);
  const customerId = (await known.json()).person.id as string;

  await open(page, "/app/sales", "page-sales");
  const screen = page.getByTestId("page-sales");

  // A normal tap outside a credit sale is still a cash sale.
  await page.getByRole("button", { name: `بيع شاي آجل ${run}` }).click();
  await expect
    .poll(async () => {
      const s = (await (await api.get("/api/sales")).json()).sales as Array<{
        paymentMethod: string;
      }>;
      return s[0]?.paymentMethod;
    }, SERVER)
    .toBe("cash");

  // The customer once: the phone (typed differently) belongs to the existing customer.
  await screen.getByTestId("credit-start").click();
  await page
    .getByTestId("page-sales")
    .getByTestId("credit-phone")
    .fill("٠١٠ ١١١١ ٢٢٢٢");
  await expect(
    page.getByTestId("page-sales").getByTestId("credit-phone-owner"),
  ).toContainText(`زبون قديم ${run}`);
  await page.getByTestId("page-sales").getByTestId("credit-continue").click();
  await expect(screen.getByTestId("credit-start")).toContainText(
    `زبون قديم ${run}`,
  );

  // Several items, different units — no customer question again.
  await page.getByRole("button", { name: `بيع شاي آجل ${run}` }).click();
  await page.getByRole("button", { name: `بيع كرتونة شاي آجل ${run}` }).click();
  await page.getByRole("button", { name: `بيع جبنة آجل ${run}` }).click();
  await expect(
    page.getByTestId("page-sales").getByTestId("credit-form"),
  ).toHaveCount(0);
  await expect(screen.getByTestId("cart-summary")).toContainText("2 صنف");
  await screen.getByTestId("cart-summary").click();
  const sheet = screen.getByTestId("cart-sheet");
  await expect(sheet.getByTestId("credit-customer")).toContainText(
    `زبون قديم ${run}`,
  );
  await expect(sheet.getByTestId("cart-line")).toHaveCount(2);
  // 11 pieces × 12.50 + 1 kg × 200 = 337.50
  await expect(sheet.getByTestId("cart-total")).toHaveText("337.50 ج.م");
  await sheet.getByTestId("cart-paid-now").fill("37.5");
  const submit = sheet.getByRole("button", { name: "تسجيل الآجل" });
  await submit.click();

  // Straight to People → «ليك» with the new balance.
  await expect(page.getByTestId("page-people")).toBeVisible(SERVER);
  await expect(page.getByTestId(`person-card-${customerId}`)).toContainText(
    "300",
    SERVER,
  );

  const sales = (await (await api.get("/api/sales")).json()).sales as Array<{
    id: string;
    paymentMethod: string;
    customerName: string | null;
    lineCount: number;
    amountPiasters: number;
  }>;
  const credit = sales.filter((s) => s.paymentMethod === "debt");
  expect(credit).toHaveLength(1);
  expect(credit[0]).toMatchObject({
    customerName: `زبون قديم ${run}`,
    lineCount: 2,
    amountPiasters: 33750,
  });
  const person = async () =>
    (await (await api.get(`/api/people/${customerId}`)).json())
      .person as Person & { transactions: Array<unknown> };
  expect((await person()).amount_piasters).toBe(30000);
  expect(await stockOf(api, tea)).toBe(30 - 1 - 11);
  expect(await stockOf(api, cheese)).toBe(4000);

  // No duplicate customer was made for that phone.
  const people = (await (await api.get("/api/people?section=owedToMe")).json())
    .people as Person[];
  expect(
    people.filter((p) => (p.phone ?? "").endsWith("1011112222")),
  ).toHaveLength(1);

  // A later partial payment reduces that invoice's balance.
  await open(page, "/app/sales", "page-sales");
  await page.getByTestId("sale-details").first().click();
  await expect(page.getByTestId("invoice-outstanding")).toHaveText(
    "300 ج.م",
    SERVER,
  );
  await page.getByTestId("invoice-collect-amount").fill("100");
  await page.getByTestId("invoice-collect-submit").click();
  await expect(page.getByTestId("invoice-outstanding")).toHaveText(
    "200 ج.م",
    SERVER,
  );
  expect((await person()).amount_piasters).toBe(20000);
});

test("آجل: a new customer is created once; the same phone later reuses them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  await product(api, `سكر آجل ${run}`, { price: 3000, stock: 10 });
  const phone = `0122${Math.floor(1e6 + Math.random() * 9e6)}`;

  await open(page, "/app/sales", "page-sales");
  const screen = page.getByTestId("page-sales");

  // Validation: a new customer needs a name.
  await screen.getByTestId("credit-start").click();
  await page.getByTestId("page-sales").getByTestId("credit-continue").click();
  await expect(
    page.getByTestId("page-sales").getByTestId("credit-error"),
  ).toBeVisible();
  await page
    .getByTestId("page-sales")
    .getByTestId("credit-name")
    .fill(`زبون جديد ${run}`);
  await page.getByTestId("page-sales").getByTestId("credit-phone").fill(phone);
  await page.getByTestId("page-sales").getByTestId("credit-continue").click();
  await page.getByRole("button", { name: `بيع سكر آجل ${run}` }).click();
  await screen.getByTestId("cart-summary").click();
  await screen.getByRole("button", { name: "تسجيل الآجل" }).click();
  await expect(page.getByTestId("page-people")).toBeVisible(SERVER);

  // A second credit sale with the same phone: the same customer, no second record.
  await open(page, "/app/sales", "page-sales");
  await screen.getByTestId("credit-start").click();
  await page
    .getByTestId("page-sales")
    .getByTestId("credit-name")
    .fill(`اسم تاني ${run}`);
  await page.getByTestId("page-sales").getByTestId("credit-phone").fill(phone);
  await expect(
    page.getByTestId("page-sales").getByTestId("credit-phone-owner"),
  ).toContainText(`زبون جديد ${run}`);
  await page.getByTestId("page-sales").getByTestId("credit-continue").click();
  await page.getByRole("button", { name: `بيع سكر آجل ${run}` }).click();
  await screen.getByTestId("cart-summary").click();
  await screen.getByRole("button", { name: "تسجيل الآجل" }).click();
  await expect(page.getByTestId("page-people")).toBeVisible(SERVER);

  const people = (await (await api.get("/api/people?section=owedToMe")).json())
    .people as Person[];
  const mine = people.filter((p) => p.phone?.endsWith(phone.slice(1)));
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({
    name: `زبون جديد ${run}`,
    amount_piasters: 6000,
  });
});
