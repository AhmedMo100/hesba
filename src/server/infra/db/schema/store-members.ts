import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { memberRoleEnum } from "./enums";
import { stores } from "./stores";
import { users } from "./users";

export const storeMembers = pgTable(
  "store_members",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").default("owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.storeId, table.userId] })],
);
