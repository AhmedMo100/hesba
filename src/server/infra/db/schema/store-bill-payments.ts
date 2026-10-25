import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { billProviders } from "./bill-providers";

export const storeBillPayments = pgTable(
  "store_bill_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    billProviderId: uuid("bill_provider_id")
      .notNull()
      .references(() => billProviders.id, { onDelete: "cascade" }),
    customerReference: text("customer_reference"),
    amountPiasters: bigint("amount_piasters", { mode: "number" }).notNull(),
    feePiasters: bigint("fee_piasters", { mode: "number" }).notNull(),
    opId: uuid("op_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("store_bill_payments_store_op_unique").on(
      table.storeId,
      table.opId,
    ),
  ],
);
