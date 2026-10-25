import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  ownerName: text("owner_name"),
  city: text("city"),
  shopType: text("shop_type").notNull(),
  governorate: text("governorate").notNull(),
  area: text("area"),
  openedOn: date("opened_on"),
  workersCount: integer("workers_count"),
  shareCustomProducts: boolean("share_custom_products").default(true).notNull(),
  receiveSuggestions: boolean("receive_suggestions").default(true).notNull(),
  settings: jsonb("settings").default({}).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
