import {
  bigint,
  boolean,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { prepaidProducts } from "./prepaid-products";

export const storePrepaidPrices = pgTable(
  "store_prepaid_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    prepaidProductId: uuid("prepaid_product_id")
      .notNull()
      .references(() => prepaidProducts.id, { onDelete: "cascade" }),
    sellPricePiasters: bigint("sell_price_piasters", {
      mode: "number",
    }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("store_prepaid_prices_store_product_unique").on(
      table.storeId,
      table.prepaidProductId,
    ),
  ],
);
