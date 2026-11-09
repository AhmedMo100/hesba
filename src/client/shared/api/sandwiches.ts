/**
 * @file sandwiches.ts
 * @description Browser client for `/api/sandwiches` and the sandwich sale (ADR-0018).
 *
 * Every call needs the server: sandwiches are not stored offline and there is no outbox for
 * them, so these functions throw `SandwichApiError` when offline or when the server rejects
 * the request. Callers show that error; nothing here reports a write as done before the
 * server accepted it.
 *
 * @usedBy features/products (SandwichFormModal, ProductsView), features/sales (SalesView)
 */

import type { SandwichInput } from "@/schemas/sandwich";
import { t } from "../i18n";

/** Client copy of the server's `SandwichView`. Money in piasters, quantities in base units. */
export interface Sandwich {
  id: string;
  name: string;
  category: string;
  sellPricePiasters: number;
  costPiasters: number;
  profitPiasters: number;
  marginPercent: number | null;
  isHidden: boolean;
  availableCount: number;
  hasMissingCost: boolean;
  ingredients: Array<{
    variantId: string;
    productId: string;
    name: string;
    unit: string;
    isWeight: boolean;
    quantityBase: number;
    buyPricePiasters: number;
    costPiasters: number;
    missingCost: boolean;
    stockBase: number;
  }>;
}

export interface SandwichIngredientOption {
  variantId: string;
  productId: string;
  name: string;
  /** English catalog name (used by search), when the product comes from the catalog. */
  nameEn?: string | null;
  unit: string;
  isWeight: boolean;
  buyPricePiasters: number;
  stockBase: number;
}

export interface IngredientShortage {
  variantId: string;
  name: string;
  unit: string;
  neededBase: number;
  availableBase: number;
}

/** A failed sandwich request, with the server's Arabic message when there is one. */
export class SandwichApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly field?: string,
    readonly shortages?: IngredientShortage[],
  ) {
    super(message);
    this.name = "SandwichApiError";
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function request<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackMessage: string,
  offlineMessage: string,
): Promise<T> {
  if (isOffline()) throw new SandwichApiError(offlineMessage, 0);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new SandwichApiError(offlineMessage, 0);
  }
  const body = (await res.json().catch(() => ({}))) as {
    error?: {
      message?: string;
      details?: { field?: string; shortages?: IngredientShortage[] };
    };
  } & T;
  if (!res.ok) {
    throw new SandwichApiError(
      body.error?.message || fallbackMessage,
      res.status,
      body.error?.details?.field,
      body.error?.details?.shortages,
    );
  }
  return body;
}

export async function fetchSandwiches(
  options: { includeHidden?: boolean } = {},
): Promise<Sandwich[]> {
  const q = options.includeHidden ? "?includeHidden=true" : "";
  const body = await request<{ sandwiches: Sandwich[] }>(
    `/api/sandwiches${q}`,
    undefined,
    t("sandwich.loadFailed"),
    t("sandwich.offline"),
  );
  return body.sandwiches ?? [];
}

export async function fetchSandwichIngredientOptions(): Promise<
  SandwichIngredientOption[]
> {
  const body = await request<{ ingredients: SandwichIngredientOption[] }>(
    "/api/sandwiches/ingredients",
    undefined,
    t("sandwich.loadFailed"),
    t("sandwich.offline"),
  );
  return body.ingredients ?? [];
}

/** Creates (no `id`) or replaces (with `id`) a sandwich; returns the server's view of it. */
export async function saveSandwich(
  input: SandwichInput,
  id?: string,
): Promise<Sandwich> {
  const body = await request<{ sandwich: Sandwich }>(
    id ? `/api/sandwiches/${id}` : "/api/sandwiches",
    { method: id ? "PATCH" : "POST", body: JSON.stringify(input) },
    t("sandwich.saveFailed"),
    t("sandwich.offline"),
  );
  return body.sandwich;
}

/**
 * Sells `count` sandwiches through `POST /api/sales` and resolves only after the server has
 * recorded the sale and deducted the ingredients. Reusing `opId` on a retry is safe: the
 * server returns the first sale instead of selling twice.
 */
export async function sellSandwich(params: {
  saleId: string;
  opId: string;
  sandwich: { id: string; name: string; sellPricePiasters: number };
  count: number;
}): Promise<{ id: string }> {
  const body = await request<{ data: { id: string } }>(
    "/api/sales",
    {
      method: "POST",
      body: JSON.stringify({
        id: params.saleId,
        opId: params.opId,
        productId: params.sandwich.id,
        name: params.sandwich.name,
        quantityBase: params.count,
        amountPiasters: params.sandwich.sellPricePiasters * params.count,
        timestamp: Date.now(),
      }),
    },
    t("sandwich.sellFailed"),
    t("sandwich.sellOnlineOnly"),
  );
  return body.data;
}
