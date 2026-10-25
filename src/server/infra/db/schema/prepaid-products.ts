import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const prepaidProducts = pgTable("prepaid_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  network: text("network").notNull(),
  denominationPiasters: bigint("denomination_piasters", {
    mode: "number",
  }).notNull(),
  dataPackageAr: text("data_package_ar"),
  validityDays: integer("validity_days"),
  costPiasters: bigint("cost_piasters", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
