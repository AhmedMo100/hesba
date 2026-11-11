import "server-only";

import { type PeopleSection } from "@/schemas/people";

export interface SuppliedProductItem {
  id: string;
  name: string;
}

export interface FormattedPerson {
  id: string;
  store_id: string;
  section: PeopleSection;
  kind: "customer" | "supplier" | "both";
  name: string;
  phone: string | null;
  /**
   * Signed balance, never floored (ADR-0023). Customers: > 0 they owe the shop, < 0 the shop
   * owes them (a credit). Payables / suppliers: > 0 the shop owes them, < 0 they owe the shop.
   */
  amount_piasters: number;
  /** The credit of a negative balance (≥ 0): what was paid beyond what was owed. */
  credit_piasters?: number;
  total_original_piasters?: number; // Opening balances + debts (not owner adjustments)
  total_paid_piasters?: number; // Collections or payments made (not owner adjustments)
  /** Σ the owner's balance adjustments, signed. */
  total_adjustments_piasters?: number;
  is_settled?: boolean; // The balance is exactly 0
  note: string | null;
  supplies: SuppliedProductItem[];
  created_at: string;
  updated_at: string;
}

export interface PeopleFinancialSummary {
  total_original_piasters: number; // إجمالي المستحق أصلًا / إجمالي الالتزامات
  total_paid_piasters: number; // إجمالي المحصل / إجمالي المسدد
  total_remaining_piasters: number; // إجمالي المتبقي (positive balances only)
  total_credit_piasters: number; // إجمالي الرصيد الزيادة (credits), shown apart
  total_count: number; // إجمالي عدد الكيانات في القسم
  active_count: number; // عدد الكيانات التي عليها/لها متبقي
  settled_count: number; // عدد الكيانات المسددة بالكامل
  credit_count: number; // عدد الكيانات اللي ليها رصيد زيادة
}

export interface PeopleListResult {
  section: PeopleSection;
  people: FormattedPerson[];
  count: number;
  total_piasters: number; // Remaining total (backwards compatibility)
  summary: PeopleFinancialSummary;
}

export interface DebtTransactionItem {
  id: string;
  direction: "owed_to_me" | "i_owe";
  type: "debt" | "payment" | "adjustment";
  /** opening | transaction | adjustment (ADR-0023). */
  kind: "opening" | "transaction" | "adjustment";
  action_label?: string; // "مستحق ليك", "تحصيل", "مستحق عليك", "سداد", "مستحق له", "سداد له"
  amount_piasters: number;
  balance_after_piasters: number; // Signed running balance after this entry (never floored)
  note: string | null;
  op_id: string;
  created_at: string;
}

export interface PersonDetailsResult {
  person: FormattedPerson;
  transactions: DebtTransactionItem[];
  summary: {
    total_original_piasters: number;
    total_paid_piasters: number;
    /** Signed balance (see `FormattedPerson.amount_piasters`). */
    remaining_piasters: number;
    credit_piasters: number;
    is_settled: boolean;
  };
}
