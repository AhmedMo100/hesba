import { pgEnum } from "drizzle-orm/pg-core";

export const memberRoleEnum = pgEnum("member_role", ["owner", "cashier"]);

export const productTypeEnum = pgEnum("product_type", [
  "stock",
  "prepaid",
  "service",
]);

export const cardSerialStatusEnum = pgEnum("card_serial_status", [
  "available",
  "sold",
  "void",
]);

export const commissionFeeTypeEnum = pgEnum("commission_fee_type", [
  "fixed",
  "percent",
]);
