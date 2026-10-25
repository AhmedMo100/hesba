import {
  bigint,
  check,
  date,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stores } from "./stores";
import { purchases } from "./purchases";
import { storeProducts } from "./store-products";
import { storeVariants } from "./store-variants";

export const purchaseLines = pgTable(
  "purchase_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    storeProductId: uuid("store_product_id").references(
      () => storeProducts.id,
      { onDelete: "set null" },
    ),
    storeVariantId: uuid("store_variant_id").references(
      () => storeVariants.id,
      { onDelete: "set null" },
    ),
    quantityBaseUnits: bigint("quantity_base_units", {
      mode: "number",
    }).notNull(),
    unitCostPiasters: bigint("unit_cost_piasters", {
      mode: "number",
    }).notNull(),
    expiresOn: date("expires_on"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "purchase_lines_product_or_variant_check",
      sql`${table.storeProductId} IS NOT NULL OR ${table.storeVariantId} IS NOT NULL`,
    ),
  ],
);
