import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * Critical journey for sandwiches (ADR-0018), against a real server and database:
 *   A. Products → إضافة منتج → ساندوتش → recipe → calculated cost → price → save →
 *      Sandwiches filter
 *   B. Edit: luncheon 5 g → 10 g, cost updates, price still editable
 *   C. Sell 2 from the sales screen → ingredients deducted exactly
 *   D. Not enough bread → sale rejected with an Arabic error, nothing deducted or saved
 *   E. Another store cannot see the sandwich
 *
 * Needs a server whose database is safe to write to (the test signs up new stores).
 */

/** Waits on server round-trips (a remote dev database can take seconds per write). */
const SERVER = { timeout: 20_000 };
/**
 * The Sales screen waits for four API calls before showing tiles. Against the remote dev
 * database each takes 1–5 s server-side, plus dev-mode compilation, so its first load needs a
 * longer wait than a single request.
 */
const PAGE_LOAD = { timeout: 45_000 };

function randomPhone(): string {
  const digits = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 10),
  ).join("");
  return `010${digits}`;
}

async function signup(api: APIRequestContext, runId: string, tag: string) {
  const res = await api.post("/api/auth/signup", {
    data: {
      ownerName: "صاحب محل تجربة",
      phone: randomPhone(),
      email: `sandwich-e2e-${tag}-${runId}@hesba.test`,
      password: "Sandwich-e2e-2026",
      storeName: `محل ساندوتشات ${tag} ${runId}`,
      shopType: "سوبر ماركت",
      governorate: "القاهرة",
    },
  });
  expect(res.ok()).toBe(true);
}

async function createIngredient(
  api: APIRequestContext,
  data: {
    nameAr: string;
    unit: string;
    buyCostPiasters: number;
    sellPricePiasters: number;
    packQty?: number;
    stock: number;
  },
): Promise<string> {
  const res = await api.post("/api/products", {
    data: {
      nameAr: data.nameAr,
      category: "ألبان وأجبان",
      unit: data.unit,
      sellPricePiasters: data.sellPricePiasters,
      buyCostPiasters: data.buyCostPiasters,
      isCustom: true,
      variants: [
        {
          packQty: data.packQty ?? 1,
          sellPricePiasters: data.sellPricePiasters,
          costPricePiasters: data.buyCostPiasters,
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
  const variantId: string = (await res.json()).data.variants[0].id;
  const stock = await api.post("/api/stock", {
    data: {
      action: "add",
      storeVariantId: variantId,
      quantityBase: data.stock,
      costPricePiasters: data.buyCostPiasters * data.stock,
    },
  });
  expect(stock.ok()).toBe(true);
  return variantId;
}

async function stockOf(api: APIRequestContext, variantId: string) {
  const body = await (await api.get("/api/stock")).json();
  const item = body.inventory.find(
    (i: { variantId: string }) => i.variantId === variantId,
  );
  return item?.currentStockBase as number;
}

async function salesNamed(api: APIRequestContext, name: string) {
  const body = await (await api.get("/api/sales")).json();
  return (
    body.sales as Array<{
      name: string;
      amountPiasters: number;
      quantity: number;
    }>
  ).filter((s) => s.name === name);
}

async function hideDevOverlay(page: Page) {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
}

test.describe("Sandwich products", () => {
  test("create, edit, sell, reject when short, and stay invisible to other stores", async ({
    page,
    browser,
  }) => {
    const runId = Math.random().toString(36).slice(2, 7);
    const api = page.request;
    await signup(api, runId, "a");

    const bread = await createIngredient(api, {
      nameAr: `عيش ${runId}`,
      unit: "piece",
      buyCostPiasters: 300, // a 30 ج bag of 10 → 3 ج a piece
      sellPricePiasters: 400,
      packQty: 10,
      stock: 10,
    });
    const luncheon = await createIngredient(api, {
      nameAr: `لانشون ${runId}`,
      unit: "kg",
      buyCostPiasters: 20000,
      sellPricePiasters: 26000,
      stock: 1000,
    });
    const cheese = await createIngredient(api, {
      nameAr: `جبنة ${runId}`,
      unit: "kg",
      buyCostPiasters: 16000,
      sellPricePiasters: 20000,
      stock: 1000,
    });
    // Two more stock items to check ordering and English search: ketchup (priority 3) and a
    // product whose own name is English ("Heinz Mayo", priority 3 via "mayo").
    const ketchup = await createIngredient(api, {
      nameAr: `كاتشب ${runId}`,
      unit: "piece",
      buyCostPiasters: 50,
      sellPricePiasters: 75,
      stock: 20,
    });
    const mayo = await createIngredient(api, {
      nameAr: `Heinz Mayo ${runId}`,
      unit: "piece",
      buyCostPiasters: 60,
      sellPricePiasters: 90,
      stock: 20,
    });
    const name = `سندوتش لانشون ${runId}`;

    // ---- A. Create -------------------------------------------------------------------
    await page.goto("/app/products");
    await hideDevOverlay(page);
    await expect(page.getByTestId("page-products")).toBeVisible();
    await expect(page.getByTestId("sandwich-load-error")).toHaveCount(0);
    // Modal interactions are scoped to the accessible dialog: in dev (React StrictMode) the
    // shared Modal briefly leaves an aria-hidden exit-animation clone (useGhost).
    const dialog = page.getByRole("dialog");
    await page.getByTestId("add-product-btn").click();
    await expect(dialog.getByTestId("add-choice-normal")).toBeVisible();
    await expect(dialog.getByTestId("add-choice-sandwich")).toBeVisible();
    await dialog.getByTestId("add-choice-sandwich").click();
    const form = dialog.getByTestId("sandwich-form");
    await expect(form).toBeVisible();

    const searchOf = (row: number) =>
      dialog.getByTestId(`sandwich-row-${row}-search`);
    const optionIds = () =>
      dialog
        .locator('[data-testid^="ingredient-option-"]')
        .evaluateAll((els) =>
          els.map((e) =>
            (e.getAttribute("data-testid") ?? "").replace(
              "ingredient-option-",
              "",
            ),
          ),
        );
    const pick = async (row: number, query: string, variantId: string) => {
      if (!(await searchOf(row).isVisible())) {
        await dialog.getByTestId(`sandwich-row-${row}-product`).click();
      }
      await searchOf(row).fill(query);
      await dialog.getByTestId(`ingredient-option-${variantId}`).click();
      await expect(searchOf(row)).toHaveCount(0);
    };

    await dialog.getByTestId("sandwich-name").fill(name);

    // Ordering: cheese/luncheon first, then ketchup/mayonnaise, then everything else.
    await dialog.getByTestId("sandwich-row-0-product").click();
    await expect(searchOf(0)).toBeVisible();
    await expect(dialog.getByTestId(`ingredient-option-${bread}`)).toBeVisible(
      SERVER,
    );
    const order = await optionIds();
    expect(order).toHaveLength(5);
    expect(new Set(order.slice(0, 2))).toEqual(new Set([cheese, luncheon]));
    expect(new Set(order.slice(2, 4))).toEqual(new Set([ketchup, mayo]));
    expect(order[4]).toBe(bread);
    // Arabic search (ة/ه-insensitive) and English search (case-insensitive)
    await searchOf(0).fill(`جبنه ${runId}`);
    expect(await optionIds()).toEqual([cheese]);
    await searchOf(0).fill("HEINZ");
    expect(await optionIds()).toEqual([mayo]);
    await searchOf(0).fill("zzz-no-such");
    await expect(
      dialog.getByText("مفيش منتج بالاسم ده في المخزون"),
    ).toBeVisible();
    await pick(0, `عيش`, bread);
    await expect(dialog.getByTestId("sandwich-row-0-product")).toContainText(
      `عيش ${runId}`,
    );
    await dialog.getByTestId("sandwich-row-0-qty").fill("1");

    // A newly added row opens its list; searching there keeps row 1 as it was.
    await dialog.getByTestId("sandwich-add-ingredient").click();
    await expect(searchOf(1)).toBeVisible();
    await searchOf(1).fill("zzz");
    await expect(dialog.getByTestId("sandwich-row-0-product")).toContainText(
      `عيش ${runId}`,
    );
    await expect(dialog.getByTestId("sandwich-row-0-qty")).toHaveValue("1");
    await searchOf(1).fill("");
    await expect(
      dialog.getByTestId(`ingredient-option-${bread}`),
    ).toBeDisabled(); // already used in row 1
    await pick(1, "لانشون", luncheon);
    await dialog.getByTestId("sandwich-row-1-qty").fill("5");
    await dialog.getByTestId("sandwich-add-ingredient").click();
    await pick(2, "جبنة", cheese);
    await dialog.getByTestId("sandwich-row-2-qty").fill("5");

    await expect(dialog.getByTestId("sandwich-row-0-cost")).toHaveText("3 ج.م");
    await expect(dialog.getByTestId("sandwich-row-1-cost")).toHaveText("1 ج.م");
    await expect(dialog.getByTestId("sandwich-row-2-cost")).toHaveText(
      "0.80 ج.م",
    );
    await expect(dialog.getByTestId("sandwich-total-cost")).toHaveText(
      "4.80 ج.م",
    );
    await dialog.getByTestId("sandwich-sell-price").fill("10");
    await expect(dialog.getByTestId("sandwich-profit")).toHaveText("5.20 ج.م");
    await dialog.getByTestId("sandwich-save").click();
    await expect(dialog).toHaveCount(0, SERVER);

    await page.getByRole("button", { name: "ساندوتشات", exact: true }).click();
    const card = page.getByText(name, { exact: true });
    await expect(card).toBeVisible(SERVER);

    // ---- B. Edit: luncheon 5 g → 10 g ---------------------------------------------------
    await card.click();
    await expect(form).toBeVisible();
    await expect(dialog.getByTestId("sandwich-name")).toHaveValue(name);
    await expect(dialog.getByTestId("sandwich-total-cost")).toHaveText(
      "4.80 ج.م",
    );
    await dialog.getByTestId("sandwich-row-1-qty").fill("10");
    await expect(dialog.getByTestId("sandwich-row-1-cost")).toHaveText("2 ج.م");
    await expect(dialog.getByTestId("sandwich-total-cost")).toHaveText(
      "5.80 ج.م",
    );
    await dialog.getByTestId("sandwich-sell-price").fill("12");
    await expect(dialog.getByTestId("sandwich-profit")).toHaveText("6.20 ج.م");
    await dialog.getByTestId("sandwich-save").click();
    await expect(dialog).toHaveCount(0, SERVER);
    const saved = await (await api.get("/api/sandwiches")).json();
    expect(
      saved.sandwiches.find((s: { name: string }) => s.name === name),
    ).toMatchObject({ costPiasters: 580, sellPricePiasters: 1200 });

    // ---- C. Sell 2 ---------------------------------------------------------------------
    await page.goto("/app/sales");
    await hideDevOverlay(page);
    const tile = page.getByRole("button", { name: `بيع ${name}` });
    await expect(tile).toBeVisible(PAGE_LOAD);
    await tile.click();
    await expect(page.getByText(`اتباع: ${name}`)).toBeVisible(SERVER);
    await expect.poll(() => stockOf(api, bread), SERVER).toBe(9);
    // The tile is usable again as soon as the first sale is recorded.
    await expect(tile).toBeEnabled(SERVER);
    await tile.click();
    await expect.poll(() => stockOf(api, bread), SERVER).toBe(8);
    expect(await stockOf(api, luncheon)).toBe(1000 - 2 * 10);
    expect(await stockOf(api, cheese)).toBe(1000 - 2 * 5);
    const sold = await salesNamed(api, name);
    expect(sold).toHaveLength(2);
    expect(sold.every((s) => s.amountPiasters === 1200)).toBe(true);

    // ---- G. "إضافة إلى البيع": quantity step, no sale until confirmed ---------------------
    const openAddToSale = async () => {
      await page.goto("/app/products");
      await hideDevOverlay(page);
      await page
        .getByRole("button", { name: "ساندوتشات", exact: true })
        .click(SERVER);
      await page.getByRole("button", { name: `خيارات ${name}` }).click(SERVER);
      await page.getByTestId(/^add-to-sale-/).click();
      await expect(page.getByTestId("page-sales")).toBeVisible(SERVER);
      await expect(dialog.getByTestId("sandwich-qty-sheet")).toBeVisible(
        PAGE_LOAD,
      );
      await expect(dialog.getByTestId("sandwich-qty-sheet")).toContainText(
        name,
      );
      await expect(dialog.getByTestId("sandwich-qty-sheet")).toContainText(
        "سعر الواحد 12 ج.م",
      );
    };
    // Cancel: nothing is saved or deducted.
    await openAddToSale();
    await dialog.getByTestId("sandwich-qty-input").fill("3");
    await expect(dialog.getByTestId("sandwich-qty-total")).toHaveText("36 ج.م");
    await dialog.getByTestId("sandwich-qty-cancel").click();
    await expect(dialog).toHaveCount(0);
    expect(await salesNamed(api, name)).toHaveLength(2);
    expect(await stockOf(api, bread)).toBe(8);
    // A reload does not reopen the step (the hand-off was consumed).
    await page.reload();
    await hideDevOverlay(page);
    await expect(tile).toBeVisible(PAGE_LOAD);
    await expect(dialog).toHaveCount(0);

    // More than the ingredients can make is blocked before reaching the server.
    await openAddToSale();
    await dialog.getByTestId("sandwich-qty-input").fill("99");
    await expect(dialog.getByTestId("sandwich-qty-confirm")).toBeDisabled();
    await expect(dialog.getByText("المكونات تكفي 8 بس")).toBeVisible();

    // Confirm 3 (via + +): exactly one sale of 3, ingredients deducted once.
    await dialog.getByTestId("sandwich-qty-input").fill("1");
    await dialog.getByTestId("sandwich-qty-plus").click();
    await dialog.getByTestId("sandwich-qty-plus").click();
    await expect(dialog.getByTestId("sandwich-qty-input")).toHaveValue("3");
    await dialog.getByTestId("sandwich-qty-minus").click();
    await dialog.getByTestId("sandwich-qty-plus").click();
    await expect(dialog.getByTestId("sandwich-qty-total")).toHaveText("36 ج.م");
    await dialog.getByTestId("sandwich-qty-confirm").click();
    await expect(dialog).toHaveCount(0, SERVER);
    await expect(page.getByText(`اتباع 3 × ${name}`)).toBeVisible(SERVER);
    const afterG = await salesNamed(api, name);
    expect(afterG).toHaveLength(3);
    expect(afterG[0]).toMatchObject({ quantity: 3, amountPiasters: 3600 });
    expect(await stockOf(api, bread)).toBe(8 - 3);
    expect(await stockOf(api, luncheon)).toBe(1000 - 2 * 10 - 3 * 10);
    expect(await stockOf(api, cheese)).toBe(1000 - 2 * 5 - 3 * 5);

    // Ordinary products still sell with one tap; the sale is now saved on the server with
    // its stock deduction in one transaction (ADR-0019).
    const ketchupTile = page.getByRole("button", {
      name: `بيع كاتشب ${runId}`,
    });
    await ketchupTile.click();
    await expect(page.getByText(`تم تسجيل بيع: كاتشب ${runId}`)).toBeVisible(
      SERVER,
    );
    await expect.poll(() => stockOf(api, ketchup), SERVER).toBe(19);
    expect(await salesNamed(api, `كاتشب ${runId}`)).toEqual([
      expect.objectContaining({ quantity: 1, amountPiasters: 75 }),
    ]);

    // ---- D. Not enough bread -------------------------------------------------------------
    const adjust = await api.post("/api/stock", {
      data: {
        action: "adjust",
        storeVariantId: bread,
        mode: "set",
        targetQuantityBase: 0,
        reason: "e2e: no bread left",
      },
    });
    expect(adjust.ok()).toBe(true);
    const luncheonBefore = await stockOf(api, luncheon);
    const cheeseBefore = await stockOf(api, cheese);

    await page.reload();
    await hideDevOverlay(page);
    await expect(tile).toBeVisible(PAGE_LOAD);
    await tile.click();
    await expect(page.getByText("المكونات مش كفاية").last()).toBeVisible(
      SERVER,
    );
    await expect(page.getByText(`عيش ${runId}`).last()).toBeVisible();
    expect(await stockOf(api, bread)).toBe(0);
    expect(await stockOf(api, luncheon)).toBe(luncheonBefore);
    expect(await stockOf(api, cheese)).toBe(cheeseBefore);
    expect(await salesNamed(api, name)).toHaveLength(3);

    // ---- E. Another store cannot see it --------------------------------------------------
    const other = await browser.newContext({
      baseURL: process.env["HESBA_APP_ORIGIN"] || "http://localhost:3000",
    });
    try {
      await signup(other.request, runId, "b");
      const list = await other.request.get(
        "/api/sandwiches?includeHidden=true",
      );
      expect(list.status()).toBe(200);
      expect((await list.json()).sandwiches).toEqual([]);
      const ingredients = await (
        await other.request.get("/api/sandwiches/ingredients")
      ).json();
      expect(ingredients.ingredients).toEqual([]);
      const products = await (
        await other.request.get("/api/products?filter=all")
      ).json();
      expect(
        products.products.some((p: { name_ar: string }) => p.name_ar === name),
      ).toBe(false);
    } finally {
      await other.close();
    }

    // ---- F. Delete a product the shop added ------------------------------------------
    const doomedName = `منتج للحذف ${runId}`;
    const doomed = await api.post("/api/products", {
      data: {
        nameAr: doomedName,
        category: "تجربة الحذف",
        unit: "piece",
        sellPricePiasters: 500,
        buyCostPiasters: 300,
        isCustom: true,
        variants: [
          { packQty: 1, sellPricePiasters: 500, costPricePiasters: 300 },
        ],
      },
    });
    expect(doomed.ok()).toBe(true);
    const doomedId: string = (await doomed.json()).data.id;
    await page.goto("/app/products");
    await hideDevOverlay(page);
    const doomedCard = page.getByTestId(`product-card-${doomedId}`);
    await expect(doomedCard).toBeVisible(SERVER);
    await page.getByRole("button", { name: `خيارات ${doomedName}` }).click();
    await page.getByTestId(`delete-product-${doomedId}`).click();
    await expect(dialog.getByTestId("delete-product-dialog")).toContainText(
      doomedName,
    );
    await dialog.getByTestId("confirm-delete-product").click();
    await expect(page.getByTestId("product-notice")).toContainText(
      doomedName,
      SERVER,
    );
    await expect(doomedCard).toHaveCount(0);
    const after = await (await api.get("/api/products?filter=all")).json();
    expect(after.products.some((p: { id: string }) => p.id === doomedId)).toBe(
      false,
    );
  });
});
