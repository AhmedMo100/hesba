import {
  bigint,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { commissionFeeTypeEnum } from "./enums";

export const commissionRules = pgTable("commission_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  fromAmountPiasters: bigint("from_amount_piasters", {
    mode: "number",
  }).notNull(),
  toAmountPiasters: bigint("to_amount_piasters", { mode: "number" }).notNull(),
  feeType: commissionFeeTypeEnum("fee_type").notNull(),
  feeValue: numeric("fee_value").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true })
    .defaultNow()
    .notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
