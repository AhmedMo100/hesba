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
  amount_piasters: number; // Current remaining balance
  total_original_piasters?: number; // Total original debts/obligations
  total_paid_piasters?: number; // Total collections or payments made
  is_settled?: boolean; // Whether account is fully settled
  note: string | null;
  supplies: SuppliedProductItem[];
  created_at: string;
  updated_at: string;
}

export interface PeopleFinancialSummary {
  total_original_piasters: number; // إجمالي المستحق أصلًا / إجمالي الالتزامات
  total_paid_piasters: number; // إجمالي المحصل / إجمالي المسدد
  total_remaining_piasters: number; // إجمالي المتبقي
  total_count: number; // إجمالي عدد الكيانات في القسم
  active_count: number; // عدد الكيانات التي عليها/لها متبقي
  settled_count: number; // عدد الكيانات المسددة بالكامل
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
  type: "debt" | "payment";
  action_label?: string; // "مستحق ليك", "تحصيل", "مستحق عليك", "سداد", "مستحق له", "سداد له"
  amount_piasters: number;
  balance_after_piasters: number; // Running balance after this transaction
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
    remaining_piasters: number;
    is_settled: boolean;
  };
}
