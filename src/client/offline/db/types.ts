/**
 * Local Dexie database types for offline-first Hesba.
 * Field names match the PostgreSQL schema exactly.
 * Money amounts are ALWAYS integers in piasters (*_minor).
 * Inventory quantities are ALWAYS integers in base units (*_base).
 * ZERO floats are permitted.
 */

export interface LocalStore {
  id: string;
  name: string;
  shop_type: string;
  governorate: string;
  area?: string | null;
  opened_on: string;
  workers_count: number;
  share_custom_products: boolean;
  receive_suggestions: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocalStoreProduct {
  id: string;
  store_id: string;
  name: string;
  name_norm: string;
  category_id?: string | null;
  global_product_id?: string | null;
  is_custom: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface LocalStoreVariant {
  id: string;
  store_id: string;
  store_product_id: string;
  name: string;
  sku?: string | null;
  sell_price_minor: number; // integer piasters
  carton_price_minor?: number | null; // integer piasters
  pack_quantity_base: number; // integer base units
  min_stock_alert_base?: number | null; // integer base units
  unit_mode: "piece" | "weight";
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface LocalStockBatch {
  id: string;
  store_id: string;
  store_variant_id: string;
  batch_code?: string | null;
  received_quantity_base: number; // integer base units
  remaining_quantity_base: number; // integer base units
  cost_price_minor: number; // integer piasters
  expiry_date?: string | null;
  supplier_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalSale {
  id: string;
  store_id: string;
  device_id: string;
  cashier_id?: string | null;
  total_minor: number; // integer piasters
  discount_minor: number; // integer piasters
  paid_minor: number; // integer piasters
  payment_method: string;
  is_voided: boolean;
  voided_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalSaleLine {
  id: string;
  sale_id: string;
  store_variant_id: string;
  unit_mode: "piece" | "pack" | "weight";
  quantity_base: number; // integer base units
  unit_price_minor: number; // integer piasters
  total_minor: number; // integer piasters
  takes?: Array<{ batch_id: string; quantity_base: number }> | null;
  created_at: string;
}

export interface LocalContact {
  id: string;
  store_id: string;
  name: string;
  phone?: string | null;
  type: "customer" | "supplier";
  section?: "owedToMe" | "iOwe" | "suppliers";
  created_at: string;
  updated_at: string;
}

export interface LocalDebtEntry {
  id: string;
  store_id: string;
  contact_id: string;
  amount_minor: number; // integer piasters
  direction: "gave" | "took";
  note?: string | null;
  recorded_at: string;
  created_at: string;
}

export interface LocalWallet {
  id: string;
  store_id: string;
  name: string;
  balance_minor: number; // integer piasters
  created_at: string;
  updated_at: string;
}

export interface LocalWalletTransaction {
  id: string;
  store_id: string;
  wallet_id: string;
  amount_minor: number; // integer piasters
  transaction_type: "income" | "expense" | "transfer";
  category?: string | null;
  note?: string | null;
  performed_at: string;
  created_at: string;
}

export interface LocalAlert {
  id: string;
  store_id: string;
  kind: string;
  ref_id?: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface LocalOutboxOp {
  op_id: string; // UUID v7
  type: string;
  payload: unknown;
  client_ts: string;
  status:
    | "pending"
    | "sending"
    | "applied"
    | "duplicate"
    | "rejected"
    | "quarantined";
  attempts: number;
  last_error?: string | null;
  created_at: string;
}

export interface LocalSyncMeta {
  key: string;
  value: string;
  updated_at?: string;
}

export interface LocalGlobalBrand {
  id: string;
  name_ar: string;
  name_en?: string | null;
}

export interface LocalGlobalProduct {
  id: string;
  brand_id?: string | null;
  name_ar: string;
  name_en?: string | null;
  name_norm: string;
  category: string;
  type: string;
  updated_at: string;
}

export interface LocalGlobalVariant {
  id: string;
  global_product_id: string;
  flavor?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  pack_qty: number;
  name_norm: string;
}
