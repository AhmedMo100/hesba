import { expect, type Page } from "@playwright/test";

/**
 * The V19 sale screen: a tile opens the sell sheet (unit, quantity, payment); its confirm
 * button sells, or adds to the open invoice. In dev mode a closing sheet leaves a copy for a
 * moment, so every step acts on the one live sheet.
 */
export async function viaSheet(
  page: Page,
  name: string,
  opts: {
    pack?: boolean;
    qty?: string;
    pay?: "cash" | "wallet" | "card";
  } = {},
) {
  await page.getByRole("button", { name: `بيع ${name}` }).click();
  await expect(page.getByTestId("sell-sheet")).toHaveCount(1);
  const sheet = page.getByTestId("sell-sheet").last();
  if (opts.pack) await sheet.getByTestId("sell-unit-pack").click();
  if (opts.qty) await sheet.getByTestId("sell-qty").fill(opts.qty);
  if (opts.pay && opts.pay !== "cash") {
    await sheet
      .getByRole("button", {
        name: opts.pay === "wallet" ? "📱 محفظة" : "💳 كارت",
      })
      .click();
  }
  await sheet.getByTestId("sell-confirm").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Opens the invoice from its summary bar and returns the live invoice sheet. */
export async function openInvoice(page: Page) {
  await page.getByTestId("page-sales").getByTestId("cart-summary").click();
  await expect(page.getByTestId("cart-sheet")).toHaveCount(1);
  return page.getByTestId("cart-sheet").last();
}
