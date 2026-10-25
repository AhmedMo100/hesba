import {
  bigint,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { contacts } from "./contacts";
import { salePaymentMethodEnum } from "./enums";

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    totalPiasters: bigint("total_piasters", { mode: "number" }).notNull(),
    paymentMethod: salePaymentMethodEnum("payment_method").notNull(),
    customerContactId: uuid("customer_contact_id").references(
      () => contacts.id,
      { onDelete: "set null" },
    ),
    opId: uuid("op_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sales_store_op_unique").on(table.storeId, table.opId),
  ],
);
