import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * QA-44 … QA-49 on the real screens, plus the sales screen's invoice and offers sheets, the
 * card's «آجل» (credit) action, and the stock card without its own edit button. Runs on both
 * projects (360 px phone and desktop).
 *
 * Needs a server whose database is safe to write to (each test signs up a new store).
 */

const PAGE_LOAD = { timeout: 60_000 };
const SERVER = { timeout: 30_000 };
/** 44 px touch targets (AGENTS.md §7), less sub-pixel rounding. */
const MIN_TARGET = 43.5;

async function signup(api: APIRequestContext) {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل واجهة",
      phone: `010${Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("")}`,
      email: `ux-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@hesba.test`,
      password: "Ux-e2e-2026-ok-pass",
      storeName: "محل واجهة",
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
  cost = 100 * stock,
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
  const data = (await res.json()).data;
  const variantId: string = data.variants[0].id;
  if (stock > 0) {
    const add = await api.post("/api/stock", {
      data: {
        action: "add",
        storeVariantId: variantId,
        quantityBase: stock,
        costPricePiasters: cost,
      },
    });
    expect(add.ok()).toBe(true);
  }
  return { productId: data.id as string, variantId };
}

async function customer(api: APIRequestContext, name: string, phone?: string) {
  const res = await api.post("/api/people", {
    data: { name, section: "owedToMe", amountEgp: "0", phone },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).person.id as string;
}

async function open(page: Page, path: string, testId: string) {
  await page.goto(path, { waitUntil: "domcontentloaded", ...PAGE_LOAD });
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await expect(page.getByTestId(testId)).toBeVisible(PAGE_LOAD);
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 900;

async function size(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, selector).not.toBeNull();
  return box!;
}

/** WCAG contrast ratio of two CSS rgb() colors. */
function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(bl!);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test("QA-49: the web app manifest is served and linked, with real icons", async ({
  page,
}) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("manifest+json");
  const m = await res.json();
  expect(m).toMatchObject({
    name: "حسبة",
    start_url: "/app",
    display: "standalone",
  });
  for (const icon of m.icons as Array<{ src: string }>) {
    const r = await page.request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"]).toBe("image/png");
  }
  await page.goto("/login", { waitUntil: "domcontentloaded", ...PAGE_LOAD });
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  // The obsolete FLoC directive is gone from the headers.
  const head = await page.request.get("/login");
  expect(head.headers()["permissions-policy"]).not.toContain("interest-cohort");
});

test("QA-44 / QA-43: Home never scrolls sideways with huge numbers, and shows Arabic units", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = page.request;
  await signup(api);
  // The largest values the server accepts: 1,000,000 pieces at 1,000,000 EGP.
  await product(api, "صنف بأرقام كبيرة جدا", 100_000_000, 1_000_000, 1e9);
  await product(api, "صنف عادي", 1250, 19);

  await open(page, "/app", "page-home");
  await expect(page.getByText("صنف بأرقام كبيرة جدا")).toBeVisible(SERVER);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const table = page.locator("table").first();
  await expect(table).toContainText("19 قطعة");
  await expect(table).not.toContainText("piece");
});

test("QA-45 / QA-46: one control per name, and touch targets of 44 px", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = page.request;
  await signup(api);
  await product(api, "صنف قرب يخلص", 1000, 2);
  const personId = await customer(api, "زبون اختبار", "01012345678");
  // An open balance, so the card shows its «تحصيل» button too.
  const tx = await api.post(`/api/people/${personId}/transactions`, {
    data: { type: "debt", amountEgp: "50" },
  });
  expect(tx.ok()).toBe(true);

  // Navigation: every label names one visible control (the header bell is not «التنبيهات»).
  await open(page, "/app", "page-home");
  for (const label of ["الرئيسية", "البيع", "المنتجات", "المخزون"]) {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toHaveCount(1);
  }
  await expect(
    page.getByRole("button", { name: "التنبيهات", exact: true }),
  ).toHaveCount(isMobile(page) ? 0 : 1);

  // People: one WhatsApp link per person, and 44 px controls.
  await open(page, "/app/people", "page-people");
  await expect(
    page.getByRole("link", { name: "تواصل واتساب زبون اختبار" }),
  ).toHaveCount(1, SERVER);
  for (const sel of [
    'a[aria-label="تواصل واتساب زبون اختبار"]',
    'button[aria-label="تعديل زبون اختبار"]',
    'button[aria-label="حذف زبون اختبار"]',
    'a[href^="tel:"]',
  ]) {
    const b = await size(page, sel);
    expect(b.height, sel).toBeGreaterThanOrEqual(MIN_TARGET);
  }

  await open(page, "/app/products", "page-products");
  const chip = await size(page, 'button:has-text("الكل")');
  expect(chip.height).toBeGreaterThanOrEqual(MIN_TARGET);

  await open(page, "/app/expenses", "page-expenses");
  const amount = await size(page, 'input[inputmode="decimal"]');
  expect(amount.height).toBeGreaterThanOrEqual(MIN_TARGET);

  await open(page, "/app/alerts", "page-alerts");
  const done = page.getByRole("button", { name: "تم" }).first();
  await expect(done).toBeVisible(SERVER);
  expect((await done.boundingBox())!.height).toBeGreaterThanOrEqual(MIN_TARGET);
});

test("sales: the invoice opens from a small summary, keeps its draft, and sells several items", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const tea = await product(api, `شاي فاتورة ${run}`, 1250, 10);
  const chips = await product(api, `شيبسي فاتورة ${run}`, 500, 10);

  await open(page, "/app/sales", "page-sales");
  // The real sheets render in the screen; a closing sheet leaves a short-lived aria-hidden
  // copy in <body> for its exit animation.
  const screen = page.getByTestId("page-sales");
  // No big cart block on the screen.
  await expect(screen.getByTestId("cart-sheet")).toHaveCount(0);
  await expect(screen.getByTestId("cart-summary")).toHaveCount(0);
  await screen.getByTestId("cart-toggle").click();
  await page.getByRole("button", { name: `بيع شاي فاتورة ${run}` }).click();
  await page.getByRole("button", { name: `بيع شيبسي فاتورة ${run}` }).click();
  await expect(screen.getByTestId("cart-sheet")).toHaveCount(0);
  await expect(screen.getByTestId("cart-summary")).toContainText("2 صنف");

  await screen.getByTestId("cart-summary").click();
  await expect(screen.getByTestId("cart-line")).toHaveCount(2);
  await screen.getByTestId("cart-discount").fill("2");
  // Close and add one more: the discount stays.
  await page.getByRole("button", { name: "إغلاق" }).click();
  await expect(screen.getByTestId("cart-sheet")).toHaveCount(0);
  await page.getByRole("button", { name: `بيع شاي فاتورة ${run}` }).click();
  await screen.getByTestId("cart-summary").click();
  await expect(screen.getByTestId("cart-discount")).toHaveValue("2");
  await expect(screen.getByTestId("cart-total")).toHaveText("28 ج.م");
  await screen.getByTestId("cart-checkout").click();
  await expect(screen.getByTestId("cart-sheet")).toHaveCount(0, SERVER);

  const stock = async (v: string) =>
    (
      (await (await api.get("/api/stock")).json()).inventory as Array<{
        variantId: string;
        currentStockBase: number;
      }>
    ).find((i) => i.variantId === v)!.currentStockBase;
  expect(await stock(tea.variantId)).toBe(8);
  expect(await stock(chips.variantId)).toBe(9);
  const sales = (await (await api.get("/api/sales")).json()).sales as Array<{
    amountPiasters: number;
    discountPiasters: number;
    lineCount: number;
  }>;
  expect(sales[0]).toMatchObject({
    amountPiasters: 2800,
    discountPiasters: 200,
    lineCount: 2,
  });
});

test("sales: a card's «آجل» opens the invoice as a credit sale on the chosen customer", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  await product(api, `رز آجل كارت ${run}`, 2000, 10);
  const buyer = await customer(api, `زبون آجل ${run}`);

  await open(page, "/app/sales", "page-sales");
  // The real sheets render in the screen; a closing sheet leaves a short-lived aria-hidden
  // copy in <body> for its exit animation.
  const screen = page.getByTestId("page-sales");
  await page
    .getByRole("button", { name: `بيع آجل: رز آجل كارت ${run}` })
    .click();
  // The customer is asked first; the card's item joins the credit invoice.
  await page
    .getByTestId("page-sales")
    .getByTestId("credit-name")
    .fill(`زبون آجل ${run}`);
  await page
    .getByTestId("page-sales")
    .getByTestId("credit-match")
    .first()
    .click();
  await expect(screen.getByTestId("cart-summary")).toContainText("1 صنف");
  await screen.getByTestId("cart-summary").click();
  const sheet = screen.getByTestId("cart-sheet");
  await expect(sheet.getByTestId("credit-customer")).toContainText(
    `زبون آجل ${run}`,
  );
  expect(buyer).toBeTruthy();
  await screen.getByTestId("cart-checkout").click();
  await expect(page.getByTestId("page-people")).toBeVisible(SERVER);
  expect(
    (await (await api.get(`/api/people/${buyer}`)).json()).person
      .amount_piasters,
  ).toBe(2000);
  const sales = (await (await api.get("/api/sales")).json()).sales as Array<{
    paymentMethod: string;
    customerName: string | null;
  }>;
  expect(sales[0]).toMatchObject({
    paymentMethod: "debt",
    customerName: `زبون آجل ${run}`,
  });
});

test("sales: offers sit behind a small «العروض» control, with readable titles (QA-47)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const juice = await product(api, `عصير عرض ${run}`, 1000, 10);
  const promo = await api.post("/api/promotions", {
    data: {
      id: `promo_${run}`,
      title: `عرض عصير ${run}`,
      type: "bundle",
      items: [
        {
          productId: juice.productId,
          variantId: juice.variantId,
          productName: `عصير عرض ${run}`,
          quantityBase: 2,
          unit: "piece",
          regularPricePiasters: 1000,
        },
      ],
      originalPricePiasters: 2000,
      promoPricePiasters: 1500,
      savingsPiasters: 500,
    },
  });
  expect(promo.ok(), await promo.text()).toBe(true);

  await open(page, "/app/sales", "page-sales");
  // The real sheets render in the screen; a closing sheet leaves a short-lived aria-hidden
  // copy in <body> for its exit animation.
  const screen = page.getByTestId("page-sales");
  await expect(screen.getByTestId("promos-sheet")).toHaveCount(0);
  await screen.getByTestId("promos-toggle").click(SERVER);
  const sheet = screen.getByTestId("promos-sheet");
  await expect(sheet).toBeVisible();
  const title = sheet.getByText(`عرض عصير ${run}`);
  await expect(title).toBeVisible();
  const [fg, bg] = await title.evaluate((el) => {
    const card = el.closest("[role=button]") as HTMLElement;
    return [getComputedStyle(el).color, getComputedStyle(card).backgroundColor];
  });
  expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(4.5);
  for (const name of [
    `تعديل العرض عرض عصير ${run}`,
    `حذف العرض عرض عصير ${run}`,
  ]) {
    // Layout size (the sheet may still be scaling in on desktop).
    const [w, h] = await sheet
      .getByRole("button", { name, exact: true })
      .evaluate((el) => [
        (el as HTMLElement).offsetWidth,
        (el as HTMLElement).offsetHeight,
      ]);
    expect(w).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(h).toBeGreaterThanOrEqual(MIN_TARGET);
  }
});

test("stock: the card opens its actions (edit included); no separate edit button", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = page.request;
  await signup(api);
  const run = Math.random().toString(36).slice(2, 6);
  const p = await product(api, `صنف مخزون ${run}`, 1000, 7);

  await open(page, "/app/stock", "page-stock");
  const card = page.getByTestId(`stock-row-${p.variantId}`);
  await expect(card).toBeVisible(SERVER);
  await expect(card.locator("button")).toHaveCount(0);
  await card.click();
  const edit = page.getByRole("button", {
    name: /تعديل كمية المخزون/,
  });
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
