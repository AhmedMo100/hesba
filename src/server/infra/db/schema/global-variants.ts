import {
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { globalProducts } from "./global-products";

export const globalVariants = pgTable(
  "global_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => globalProducts.id, { onDelete: "cascade" }),
    flavor: text("flavor"),
    sizeValue: numeric("size_value"),
    sizeUnit: text("size_unit"),
    packQty: integer("pack_qty").default(1).notNull(),
    barcode: text("barcode"),
    nameNorm: text("name_norm").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("global_variants_barcode_unique")
      .on(table.barcode)
      .where(sql`${table.barcode} IS NOT NULL`),
  ],
);
