import {
  bigint,
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";
import { globalProducts } from "./global-products";

export const storeProducts = pgTable(
  "store_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    globalProductId: uuid("global_product_id").references(
      () => globalProducts.id,
      { onDelete: "set null" },
    ),
    nameAr: text("name_ar"),
    category: text("category").notNull(),
    unit: text("unit").notNull(),
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
    check(
      "store_products_name_or_global_check",
      sql`${table.globalProductId} IS NOT NULL OR (${table.nameAr} IS NOT NULL AND ${table.nameAr} <> '')`,
    ),
    check(
      "store_products_unit_check",
      sql`${table.unit} IN ('g', 'kg', 'ml', 'l', 'piece')`,
    ),
  ],
);
