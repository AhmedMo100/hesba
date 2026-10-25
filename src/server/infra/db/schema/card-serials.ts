import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { serviceItems } from "./service-items";
import { prepaidProducts } from "./prepaid-products";
import { cardSerialStatusEnum } from "./enums";

export const cardSerials = pgTable("card_serials", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  serviceItemId: uuid("service_item_id").references(() => serviceItems.id, {
    onDelete: "set null",
  }),
  prepaidProductId: uuid("prepaid_product_id").references(
    () => prepaidProducts.id,
    { onDelete: "set null" },
  ),
  cardNumberEncrypted: text("card_number_encrypted").notNull(),
  pinEncrypted: text("pin_encrypted").notNull(),
  status: cardSerialStatusEnum("status").default("available").notNull(),
  soldAt: timestamp("sold_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
