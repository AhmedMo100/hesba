import { bigint, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { storeVariants } from "./store-variants";
import { serviceItems } from "./service-items";
import { cardSerials } from "./card-serials";

export const saleLines = pgTable("sale_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  saleId: uuid("sale_id"),
  storeVariantId: uuid("store_variant_id").references(() => storeVariants.id, {
    onDelete: "set null",
  }),
  serviceItemId: uuid("service_item_id").references(() => serviceItems.id, {
    onDelete: "set null",
  }),
  cardSerialId: uuid("card_serial_id").references(() => cardSerials.id, {
    onDelete: "set null",
  }),
  amountPiasters: bigint("amount_piasters", { mode: "number" }).notNull(),
  feePiasters: bigint("fee_piasters", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
