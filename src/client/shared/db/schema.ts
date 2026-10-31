import Dexie, { type Table } from "dexie";
import type {
  LocalAlert,
  LocalContact,
  LocalDebtEntry,
  LocalGlobalBrand,
  LocalGlobalProduct,
  LocalGlobalVariant,
  LocalOutboxOp,
  LocalSale,
  LocalSaleLine,
  LocalStockBatch,
  LocalStore,
  LocalStoreProduct,
  LocalStoreVariant,
  LocalSyncMeta,
  LocalWallet,
  LocalWalletTransaction,
} from "./types";

export class HesbaDatabase extends Dexie {
  stores!: Table<LocalStore, string>;
  store_products!: Table<LocalStoreProduct, string>;
  store_variants!: Table<LocalStoreVariant, string>;
  store_stock_batches!: Table<LocalStockBatch, string>;
  sales!: Table<LocalSale, string>;
  sale_lines!: Table<LocalSaleLine, string>;
  contacts!: Table<LocalContact, string>;
  debt_entries!: Table<LocalDebtEntry, string>;
  wallets!: Table<LocalWallet, string>;
  wallet_transactions!: Table<LocalWalletTransaction, string>;
  alerts!: Table<LocalAlert, string>;
  outbox!: Table<LocalOutboxOp, string>;
  sync_meta!: Table<LocalSyncMeta, string>;
  global_brands!: Table<LocalGlobalBrand, string>;
  global_products!: Table<LocalGlobalProduct, string>;
  global_variants!: Table<LocalGlobalVariant, string>;

  constructor(dbName = "hesba_db") {
    super(dbName);

    // Schema Version 1: Initial local tables matching server Postgres schema
    this.version(1).stores({
      stores: "id, shop_type",
      store_products:
        "id, store_id, name_norm, category_id, is_active, deleted_at",
      store_variants: "id, store_id, store_product_id, deleted_at",
      store_stock_batches: "id, store_id, store_variant_id, expiry_date",
      sales: "id, store_id, created_at, is_voided",
      sale_lines: "id, sale_id, store_variant_id",
      contacts: "id, store_id, name, type",
      debt_entries: "id, store_id, contact_id, recorded_at",
      wallets: "id, store_id",
      wallet_transactions: "id, store_id, wallet_id, performed_at",
      alerts: "id, store_id, is_read, created_at",
      outbox: "op_id, status, created_at",
      sync_meta: "key",
    });

    // Schema Version 2: Adds SKU index to store_variants and updated_at index + upgrade function for sync_meta
    this.version(2)
      .stores({
        store_variants: "id, store_id, store_product_id, sku, deleted_at",
        sync_meta: "key, updated_at",
      })
      .upgrade((tx) => {
        // Upgrade migration function: ensures existing sync_meta entries gain updated_at timestamp
        return tx
          .table("sync_meta")
          .toCollection()
          .modify((meta) => {
            if (!meta.updated_at) {
              meta.updated_at = new Date().toISOString();
            }
          });
      });

    // Schema Version 3: Adds public catalog tables for offline catalog search & variant selection
    this.version(3).stores({
      global_brands: "id, name_ar",
      global_products: "id, brand_id, name_norm, category, type, updated_at",
      global_variants: "id, global_product_id, name_norm",
    });
  }
}

/**
 * Validates that an amount is a valid integer piaster value.
 * Throws an Error if value is fractional or not an integer.
 */
export function assertIntegerPiasters(
  amountMinor: number,
  fieldName = "amount",
): void {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(
      `Money ${fieldName} must be an integer (piasters), got: ${amountMinor}`,
    );
  }
}

/**
 * Validates that a quantity is a valid integer base unit value.
 * Throws an Error if value is fractional or not an integer.
 */
export function assertIntegerBaseUnits(
  qtyBase: number,
  fieldName = "quantity",
): void {
  if (!Number.isInteger(qtyBase)) {
    throw new Error(
      `Quantity ${fieldName} must be an integer (base units), got: ${qtyBase}`,
    );
  }
}
