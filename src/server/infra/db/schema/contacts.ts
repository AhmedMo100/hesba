import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { contactKindEnum } from "./enums";

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  kind: contactKindEnum("kind").notNull(),
  nameAr: text("name_ar").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
