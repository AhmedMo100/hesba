import {
  bigint,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { contacts } from "./contacts";

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    supplierContactId: uuid("supplier_contact_id").references(
      () => contacts.id,
      { onDelete: "set null" },
    ),
    totalPiasters: bigint("total_piasters", { mode: "number" }).notNull(),
    opId: uuid("op_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("purchases_store_op_unique").on(table.storeId, table.opId),
  ],
);
