import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { aiMessageRoleEnum } from "./enums";

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  role: aiMessageRoleEnum("role").notNull(),
  bodyText: text("body_text").notNull(),
  conversationId: uuid("conversation_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
