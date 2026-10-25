import { bigint, check, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";
import { sales } from "./sales";
import { storeProducts } from "./store-products";
import { storeVariants } from "./store-variants";
import { serviceItems } from "./service-items";
import { cardSerials } from "./card-serials";
import { storeBillPayments } from "./store-bill-payments";

export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").references(() => sales.id, {
      onDelete: "cascade",
    }),
    storeProductId: uuid("store_product_id").references(
      () => storeProducts.id,
      { onDelete: "set null" },
    ),
    storeVariantId: uuid("store_variant_id").references(
      () => storeVariants.id,
      { onDelete: "set null" },
    ),
    serviceItemId: uuid("service_item_id").references(() => serviceItems.id, {
      onDelete: "set null",
    }),
    cardSerialId: uuid("card_serial_id").references(() => cardSerials.id, {
      onDelete: "set null",
    }),
    storeBillPaymentId: uuid("store_bill_payment_id").references(
      () => storeBillPayments.id,
      { onDelete: "set null" },
    ),
    amountPiasters: bigint("amount_piasters", { mode: "number" }).notNull(),
    feePiasters: bigint("fee_piasters", { mode: "number" })
      .default(0)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "sale_lines_exactly_one_item_check",
      sql`((CASE WHEN ${table.storeProductId} IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN ${table.storeVariantId} IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN ${table.cardSerialId} IS NOT NULL THEN 1 ELSE 0 END) + (CASE WHEN ${table.storeBillPaymentId} IS NOT NULL THEN 1 ELSE 0 END) = 1)`,
    ),
  ],
);
