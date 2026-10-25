import {
  bigint,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./stores";
import { wallets } from "./wallets";
import { commissionRules } from "./commission-rules";
import { walletTransactionKindEnum } from "./enums";

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    walletId: uuid("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    kind: walletTransactionKindEnum("kind").notNull(),
    amountPiasters: bigint("amount_piasters", { mode: "number" }).notNull(),
    feePiasters: bigint("fee_piasters", { mode: "number" }).notNull(),
    balanceAfterPiasters: bigint("balance_after_piasters", {
      mode: "number",
    }).notNull(),
    commissionRuleId: uuid("commission_rule_id").references(
      () => commissionRules.id,
      { onDelete: "set null" },
    ),
    opId: uuid("op_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("wallet_transactions_store_op_unique").on(
      table.storeId,
      table.opId,
    ),
  ],
);
