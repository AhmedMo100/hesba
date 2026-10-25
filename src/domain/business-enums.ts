import { z } from "zod";

export const billTypeSchema = z.enum([
  "internet",
  "mobile",
  "landline",
  "electricity",
  "gas",
  "water",
  "other",
]);

export type BillType = z.infer<typeof billTypeSchema>;

export const walletProviderSchema = z.enum([
  "vodafone_cash",
  "instapay",
  "other",
]);

export type WalletProvider = z.infer<typeof walletProviderSchema>;
