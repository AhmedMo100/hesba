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

export const billTypeEnum = pgEnum("bill_type", [
  "internet",
  "mobile",
  "landline",
  "electricity",
  "gas",
  "water",
  "other",
]);

export const walletProviderEnum = pgEnum("wallet_provider", [
  "vodafone_cash",
  "instapay",
  "other",
]);

export const walletTransactionKindEnum = pgEnum("wallet_transaction_kind", [
  "transfer_in",
  "transfer_out",
  "withdrawal",
  "owner_deposit",
  "reversal",
]);

export const contactKindEnum = pgEnum("contact_kind", [
  "customer",
  "supplier",
  "both",
]);

export const debtDirectionEnum = pgEnum("debt_direction", [
  "owed_to_me",
  "i_owe",
]);

export const salePaymentMethodEnum = pgEnum("sale_payment_method", [
  "cash",
  "wallet",
  "card",
  "debt",
]);

export const alertSeverityEnum = pgEnum("alert_severity", [
  "info",
  "warning",
  "critical",
]);

export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "user",
  "assistant",
]);
