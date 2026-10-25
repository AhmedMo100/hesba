import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { billTypeEnum } from "./enums";

export const billProviders = pgTable("bill_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  nameAr: text("name_ar").notNull(),
  billType: billTypeEnum("bill_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
