import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { type AnyPgColumn } from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { contacts } from "./contacts";
import { debtDirectionEnum } from "./enums";

export const debtEntries = pgTable(
  "debt_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    direction: debtDirectionEnum("direction").notNull(),
    amountPiasters: bigint("amount_piasters", { mode: "number" }).notNull(),
    noteAr: text("note_ar"),
    settlesEntryId: uuid("settles_entry_id").references(
      (): AnyPgColumn => debtEntries.id,
      { onDelete: "set null" },
    ),
    opId: uuid("op_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("debt_entries_store_op_unique").on(table.storeId, table.opId),
  ],
);
