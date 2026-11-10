/**
 * @file sales.ts
 * @description Browser client for `POST /api/sales` (ADR-0019). The server records the sale
 * and its stock deduction in one transaction; this function resolves only once the server
 * has accepted the sale and throws `SaleApiError` otherwise (offline, stock short, rejected,
 * server error). Nothing here reports a sale as done before the server answered.
 *
 * @usedBy features/sales (SalesView)
 */

import type { RecordedSale } from "@/schemas/sale";
import { t } from "../i18n";

export type { RecordedSale, RecordedSaleLine } from "@/schemas/sale";

/** A sale the server did not record, with its Arabic message when there is one. */
export class SaleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SaleApiError";
  }
}

/** What the Sales screen sends; see `createSaleSchema` for the rules per kind of sale. */
export interface SaleRequest {
  /** Idempotency key: send the same value again to retry the SAME sale. */
  opId: string;
  id?: string;
  variantId?: string;
  productId?: string;
  promotionId?: string;
  name?: string;
  quantityBase?: number;
  /** Services only: what the customer paid. Ignored for goods, sandwiches and offers. */
  amountPiasters?: number;
  label?: string;
  isCarton?: boolean;
  commissionPiasters?: number;
  machineId?: string;
  machineDeductPiasters?: number;
  machineName?: string;
}

export async function postSale(body: SaleRequest): Promise<RecordedSale> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new SaleApiError(t("sale.onlineOnly"), 0);
  }
  let res: Response;
  try {
    res = await fetch("/api/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SaleApiError(t("sale.onlineOnly"), 0);
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: RecordedSale;
    error?: { message?: string };
  };
  if (!res.ok || !json.data) {
    throw new SaleApiError(json.error?.message || t("sale.failed"), res.status);
  }
  return json.data;
}
