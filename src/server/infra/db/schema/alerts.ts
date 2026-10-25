import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { alertSeverityEnum } from "./enums";

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  severity: alertSeverityEnum("severity").notNull(),
  messageAr: text("message_ar").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
