import {
  bigint,
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";
import { storeProducts } from "./store-products";
import { globalProducts } from "./global-products";
import { globalVariants } from "./global-variants";

export const storeVariants = pgTable(
  "store_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    storeProductId: uuid("store_product_id").references(
      () => storeProducts.id,
      { onDelete: "cascade" },
    ),
    productId: uuid("product_id").references(() => globalProducts.id, {
      onDelete: "cascade",
    }),
    globalVariantId: uuid("global_variant_id").references(
      () => globalVariants.id,
      { onDelete: "set null" },
    ),
    flavor: text("flavor"),
    sizeValue: numeric("size_value"),
    sizeUnit: text("size_unit"),
    packQty: integer("pack_qty").default(1).notNull(),
    barcode: text("barcode"),
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
    uniqueIndex("store_variants_store_barcode_unique")
      .on(table.storeId, table.barcode)
      .where(sql`${table.barcode} IS NOT NULL`),
  ],
);
