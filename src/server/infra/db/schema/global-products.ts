import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { brands } from "./brands";
import { productTypeEnum } from "./enums";

export const globalProducts = pgTable("global_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  nameNorm: text("name_norm").notNull(),
  category: text("category").notNull(),
  type: productTypeEnum("type").default("stock").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
