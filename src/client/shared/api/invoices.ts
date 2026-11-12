/**
 * @file invoices.ts
 * @description Browser client for supplier purchases (QA-30) and sale invoices — cart
 * checkout, credit payments, returns (QA-31). These are online operations: the server prices,
 * checks and records them in one transaction; the screen shows only what the server answered.
 * Every write sends a client `opId` so a retried request is applied once.
 */
import type { PurchaseView } from "@/schemas/purchase";
import type { PaymentMethod, SaleInvoice } from "@/schemas/sale";

export type { PurchaseView, SaleInvoice, PaymentMethod };

/** A refused request, with the server's Arabic message. */
export class InvoiceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function send<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new InvoiceApiError("مفيش اتصال بالسيرفر، جرّب تاني", 0);
  }
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { message?: string } }) | null;
  if (!res.ok || !json) {
    throw new InvoiceApiError(
      json?.error?.message || "حصل خطأ، جرّب تاني",
      res.status,
    );
  }
  return json;
}

// ---- Supplier purchases (QA-30) ------------------------------------------------------

export async function listSupplierPurchases(
  supplierId: string,
): Promise<PurchaseView[]> {
  const r = await send<{ purchases: PurchaseView[] }>(
    "GET",
    `/api/purchases?supplierId=${encodeURIComponent(supplierId)}`,
  );
  return r.purchases;
}

export async function createPurchase(body: {
  opId: string;
  supplierId: string;
  lines: Array<{
    storeVariantId: string;
    quantityBase: number;
    totalCostPiasters: number;
    expiryDate?: string | null;
  }>;
  paidNowPiasters: number;
  note?: string | null;
}): Promise<PurchaseView> {
  return (
    await send<{ purchase: PurchaseView }>("POST", "/api/purchases", body)
  ).purchase;
}

export async function payPurchase(
  purchaseId: string,
  opId: string,
  amountPiasters: number,
): Promise<PurchaseView> {
  return (
    await send<{ purchase: PurchaseView }>(
      "POST",
      `/api/purchases/${purchaseId}/payments`,
      { opId, amountPiasters },
    )
  ).purchase;
}

export async function voidPurchase(
  purchaseId: string,
  opId: string,
): Promise<PurchaseView> {
  return (
    await send<{ purchase: PurchaseView }>(
      "POST",
      `/api/purchases/${purchaseId}/void`,
      {
        opId,
      },
    )
  ).purchase;
}

// ---- Sale invoices (QA-31) -----------------------------------------------------------

export async function checkout(body: {
  opId: string;
  lines: Array<{ variantId: string; quantityBase: number }>;
  discountPiasters: number;
  paymentMethod: PaymentMethod;
  customerId?: string | null;
  paidNowPiasters: number;
}): Promise<SaleInvoice> {
  return (
    await send<{ invoice: SaleInvoice }>("POST", "/api/sales/checkout", body)
  ).invoice;
}

export async function getSaleInvoice(saleId: string): Promise<SaleInvoice> {
  return (await send<{ invoice: SaleInvoice }>("GET", `/api/sales/${saleId}`))
    .invoice;
}

export async function paySaleInvoice(
  saleId: string,
  opId: string,
  amountPiasters: number,
): Promise<SaleInvoice> {
  return (
    await send<{ invoice: SaleInvoice }>(
      "POST",
      `/api/sales/${saleId}/payments`,
      {
        opId,
        amountPiasters,
      },
    )
  ).invoice;
}

export async function returnSaleLines(
  saleId: string,
  opId: string,
  lines: Array<{
    saleLineId: string;
    quantityBase: number;
    condition?: "sellable" | "damaged";
  }>,
): Promise<SaleInvoice> {
  return (
    await send<{ invoice: SaleInvoice }>(
      "POST",
      `/api/sales/${saleId}/returns`,
      {
        opId,
        lines,
      },
    )
  ).invoice;
}

// ---- A customer's credit invoices («ليك», Prompt 2) ----------------------------------------

export type { CustomerInvoicesView } from "@/schemas/sale";

export async function listCustomerInvoices(
  customerId: string,
): Promise<import("@/schemas/sale").CustomerInvoicesView> {
  return send("GET", `/api/people/${encodeURIComponent(customerId)}/invoices`);
}
