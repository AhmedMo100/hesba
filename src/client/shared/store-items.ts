/**
 * @file store-items.ts
 * @description Client-side shapes of the store's products and stock rows, as returned by
 * `GET /api/products` and `GET /api/stock`, plus the product-kind helper several screens need.
 *
 * Lives in `shared/` because the products, stock, sales, alerts and home features all read
 * these shapes. Before ADR-0017 they were exported from `ProductsView.tsx` and `StockView.tsx`,
 * which made modals and views import each other in cycles.
 *
 * @usedBy
 * - features/products, features/stock, features/sales, features/alerts, features/home
 */

import { isServiceProduct as isServiceProductRule } from "@/domain/sale-pricing";

/** A store product with its variants. Money in integer piasters; quantities in base units. */
export interface StoreProductItem {
  id: string;
  name_ar: string;
  name_norm?: string;
  category: string;
  unit: string;
  sell_price_piasters: number;
  buy_cost_piasters?: number;
  stock_quantity?: number;
  barcode?: string | null;
  brand_name?: string | null;
  is_custom: boolean;
  added_by_this_store?: boolean;
  is_hidden?: boolean;
  global_product_id?: string | null;
  /** 'standard' or 'sandwich' (a composite made from ingredients, ADR-0018). */
  kind?: string;
  variants: Array<{
    id?: string;
    flavor?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
    pack_qty?: number;
    barcode?: string | null;
    sell_price_piasters: number;
    buy_cost_piasters?: number;
    stock_quantity?: number;
    global_variant_id?: string | null;
    is_active?: boolean;
  }>;
}

/**
 * True for telecom/payment service products (top-ups, bills, transfers, cards).
 *
 * @remarks Services have no physical stock: they are sold against a POS machine or wallet
 * balance, so stock screens and the sale flow treat them differently. The check matches the
 * fixed service category names stored on the product (or the `service` unit). The rule lives in
 * `@/domain/sale-pricing` so the server classifies a sold product the same way.
 */
export const isServiceProduct = (p: StoreProductItem) =>
  isServiceProductRule(p);

/** One sellable variant's stock position, with its batches (FEFO order is decided server-side). */
export interface StockInventoryItem {
  variantId: string;
  productId: string;
  productName: string;
  category?: string;
  brandName?: string;
  isCustom?: boolean;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  sellPricePiasters: number;
  buyPricePiasters?: number;
  currentStockBase: number;
  status: "ok" | "low" | "out";
  hasNearExpiry: boolean;
  unit?: string;
  packName?: string | null;
  batches: Array<{
    id: string;
    batchCode?: string | null;
    receivedQty: number;
    remainingQty: number;
    costPricePiasters: number;
    expiryDate?: string | null;
    isNearExpiry: boolean;
    receivedAt: string;
  }>;
}
