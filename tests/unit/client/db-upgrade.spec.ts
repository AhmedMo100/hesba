import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import {
  HesbaDatabase,
  assertIntegerPiasters,
  assertIntegerBaseUnits,
} from "@/client/shared/db";
import type {
  LocalStore,
  LocalStoreProduct,
  LocalStoreVariant,
  LocalStockBatch,
  LocalSale,
  LocalSaleLine,
} from "@/client/shared/db";

describe("Dexie Database Schema & Version 1 -> Version 2 Upgrade (P2-F-03)", () => {
  const DB_NAME = "hesba_test_upgrade_db";

  beforeEach(async () => {
    // Delete any previous database state
    await Dexie.delete(DB_NAME);
  });

  it("data written at version 1 is completely preserved and readable after version 2 upgrade", async () => {
    // 1. Initialize Database strictly at Version 1
    const v1Db = new Dexie(DB_NAME);
    v1Db.version(1).stores({
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

    await v1Db.open();

    const sampleStore: LocalStore = {
      id: "store-01",
      name: "سوبر ماركت النور",
      shop_type: "سوبر ماركت",
      governorate: "القاهرة",
      area: "المعادي",
      opened_on: "2022-05-01",
      workers_count: 3,
      share_custom_products: true,
      receive_suggestions: true,
      created_at: "2026-10-28T00:00:00Z",
      updated_at: "2026-10-28T00:00:00Z",
    };

    const sampleProduct: LocalStoreProduct = {
      id: "prod-01",
      store_id: "store-01",
      name: "جبنة بيضاء دومتي",
      name_norm: "جبنه بيضاء دومتي",
      is_custom: false,
      is_active: true,
      created_at: "2026-10-28T00:00:00Z",
      updated_at: "2026-10-28T00:00:00Z",
    };

    const sampleVariant: LocalStoreVariant = {
      id: "var-01",
      store_id: "store-01",
      store_product_id: "prod-01",
      name: "علبة 500 جرام",
      sell_price_minor: 4500, // 45.00 EGP in integer piasters
      carton_price_minor: 50000, // 500.00 EGP in integer piasters
      pack_quantity_base: 12, // 12 base units per carton
      min_stock_alert_base: 5,
      unit_mode: "piece",
      created_at: "2026-10-28T00:00:00Z",
      updated_at: "2026-10-28T00:00:00Z",
    };

    const sampleBatch: LocalStockBatch = {
      id: "batch-01",
      store_id: "store-01",
      store_variant_id: "var-01",
      received_quantity_base: 48,
      remaining_quantity_base: 48,
      cost_price_minor: 3800, // 38.00 EGP in integer piasters
      expiry_date: "2027-01-01",
      created_at: "2026-10-28T00:00:00Z",
      updated_at: "2026-10-28T00:00:00Z",
    };

    const sampleSale: LocalSale = {
      id: "sale-01",
      store_id: "store-01",
      device_id: "dev-01",
      total_minor: 9000, // 90.00 EGP in integer piasters
      discount_minor: 0,
      paid_minor: 9000,
      payment_method: "cash",
      is_voided: false,
      created_at: "2026-10-28T00:00:00Z",
      updated_at: "2026-10-28T00:00:00Z",
    };

    const sampleSaleLine: LocalSaleLine = {
      id: "line-01",
      sale_id: "sale-01",
      store_variant_id: "var-01",
      unit_mode: "piece",
      quantity_base: 2,
      unit_price_minor: 4500,
      total_minor: 9000,
      created_at: "2026-10-28T00:00:00Z",
    };

    // Write records under v1
    await v1Db.table("stores").add(sampleStore);
    await v1Db.table("store_products").add(sampleProduct);
    await v1Db.table("store_variants").add(sampleVariant);
    await v1Db.table("store_stock_batches").add(sampleBatch);
    await v1Db.table("sales").add(sampleSale);
    await v1Db.table("sale_lines").add(sampleSaleLine);
    await v1Db.table("sync_meta").add({ key: "cursor", value: "100" });

    // Close v1 database
    v1Db.close();

    // 2. Open upgraded Database using HesbaDatabase (which declares v1, v2, and v3)
    const upgradedDb = new HesbaDatabase(DB_NAME);
    await upgradedDb.open();

    expect(upgradedDb.verno).toBe(3);

    // 3. Verify all records written under v1 are preserved exactly
    const store = await upgradedDb.stores.get("store-01");
    expect(store).toBeDefined();
    expect(store?.name).toBe("سوبر ماركت النور");
    expect(store?.workers_count).toBe(3);

    const product = await upgradedDb.store_products.get("prod-01");
    expect(product).toBeDefined();
    expect(product?.name_norm).toBe("جبنه بيضاء دومتي");

    const variant = await upgradedDb.store_variants.get("var-01");
    expect(variant).toBeDefined();
    expect(variant?.name).toBe("علبة 500 جرام");
    expect(variant?.sell_price_minor).toBe(4500);

    const batch = await upgradedDb.store_stock_batches.get("batch-01");
    expect(batch).toBeDefined();
    expect(batch?.remaining_quantity_base).toBe(48);
    expect(batch?.cost_price_minor).toBe(3800);

    const sale = await upgradedDb.sales.get("sale-01");
    expect(sale).toBeDefined();
    expect(sale?.total_minor).toBe(9000);

    const line = await upgradedDb.sale_lines.get("line-01");
    expect(line).toBeDefined();
    expect(line?.quantity_base).toBe(2);

    // 4. Verify v1 -> v2 upgrade function executed: sync_meta entries received updated_at
    const meta = await upgradedDb.sync_meta.get("cursor");
    expect(meta).toBeDefined();
    expect(meta?.value).toBe("100");
    expect(meta?.updated_at).toBeDefined();

    upgradedDb.close();
  });

  describe("Integer Money and Base Unit Precision Math", () => {
    it("stores money amounts strictly as integers in piasters (*_minor)", () => {
      // 10.50 EGP = 1050 piasters
      expect(Number.isInteger(1050)).toBe(true);
      expect(() =>
        assertIntegerPiasters(1050, "sell_price_minor"),
      ).not.toThrow();

      // Fractional piasters (e.g. 10.505) are rejected
      expect(() => assertIntegerPiasters(10.5, "sell_price_minor")).toThrow(
        "Money sell_price_minor must be an integer",
      );
    });

    it("stores inventory quantities strictly as integers in base units (*_base)", () => {
      // Pieces: 5 pieces
      expect(() => assertIntegerBaseUnits(5, "quantity_base")).not.toThrow();

      // Weighed item: 1.5 kg = 1500 grams (integer base units)
      expect(() => assertIntegerBaseUnits(1500, "quantity_base")).not.toThrow();

      // Fractional kilogram (1.5) without base unit conversion is rejected
      expect(() => assertIntegerBaseUnits(1.5, "quantity_base")).toThrow(
        "Quantity quantity_base must be an integer",
      );
    });
  });
});
