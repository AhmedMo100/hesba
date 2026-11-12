/**
 * @file sales.ts
 * @description Browser client for the sales API: `POST /api/sales` (ADR-0019), the sales
 * list, and `POST /api/sales/void` (ADR-0022). The server records the sale
 * and its stock deduction in one transaction; this function resolves only once the server
 * has accepted the sale and throws `SaleApiError` otherwise (offline, stock short, rejected,
 * server error). Nothing here reports a sale as done before the server answered.
 *
 * @usedBy features/sales (SalesView)
 */

import type { RecordedSale, VoidedSale } from "@/schemas/sale";
import { t } from "../i18n";

export type {
  RecordedSale,
  RecordedSaleLine,
  VoidedSale,
} from "@/schemas/sale";

/** A sale the server did not record, with its Arabic message when there is one. */
export class SaleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
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

/** How long to wait for the server before treating the answer as lost (status 0). */
export const SALE_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sends one sale and resolves only with the server's recorded sale. `status` 0 means there
 * was no answer (offline, network drop, timeout): the sale MAY have been recorded, so the
 * caller must retry with the same `opId` rather than treat it as failed or as done.
 */
export async function postSale(
  body: SaleRequest,
  options: {
    timeoutMs?: number;
    /**
     * The shop this sale belongs to (queued sales). The server refuses it with
     * `STORE_MISMATCH` when another shop is signed in, instead of trying it in that shop.
     */
    storeId?: string;
  } = {},
): Promise<RecordedSale> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new SaleApiError(t("sale.onlineOnly"), 0);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? SALE_REQUEST_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch("/api/sales", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.storeId ? { "X-Hesba-Store-Id": options.storeId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new SaleApiError(t("sale.onlineOnly"), 0);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: RecordedSale;
    error?: { message?: string; code?: string };
  };
  if (!res.ok || !json.data) {
    throw new SaleApiError(
      json.error?.message || t("sale.failed"),
      res.status,
      json.error?.code,
    );
  }
  return json.data;
}

/** One recorded sale in the Sales screen list (`GET /api/sales`). */
export interface ListedSale {
  id: string;
  productId: string;
  name: string;
  amountPiasters: number;
  quantity: number;
  category: string;
  unit: string;
  timestamp: number;
  costPiasters: number | null;
  /** Undone with a void (ADR-0022): shown for the record, never counted. */
  voided: boolean;
  voidedAt: number | null;
}

/** The server's sales list: the ONLY source of recorded sales on the Sales screen (QA-09). */
export interface SalesOverview {
  sales: ListedSale[];
  todaySales: ListedSale[];
  /** Today's (Cairo) total of the sales that were not voided. */
  todayTotalPiasters: number;
  todayCount: number;
}

/** Reads the shop's recorded sales; throws when the server did not answer with the list. */
export async function fetchSalesOverview(
  signal?: AbortSignal,
): Promise<SalesOverview> {
  const res = await fetch("/api/sales", { signal });
  const json = (await res.json().catch(() => null)) as SalesOverview | null;
  if (!res.ok || !json || !Array.isArray(json.todaySales)) {
    throw new SaleApiError(t("sale.listFailed"), res.status);
  }
  return json;
}

/**
 * Undoes a recorded sale (`POST /api/sales/void`, ADR-0022). Resolves only once the server
 * voided it and restored its stock; nothing changes on screen before that.
 */
export async function voidSale(
  saleId: string,
  opId: string,
): Promise<VoidedSale> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new SaleApiError(t("sale.voidOnlineOnly"), 0);
  }
  let res: Response;
  try {
    res = await fetch("/api/sales/void", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId, opId }),
    });
  } catch {
    throw new SaleApiError(t("sale.voidOnlineOnly"), 0);
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: VoidedSale;
    error?: { message?: string; code?: string };
  };
  if (!res.ok || !json.data) {
    throw new SaleApiError(
      json.error?.message || t("sale.voidFailed"),
      res.status,
      json.error?.code,
    );
  }
  return json.data;
}
