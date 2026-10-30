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
  amount_piasters: number;
  note: string | null;
  supplies: SuppliedProductItem[];
  created_at: string;
  updated_at: string;
}

export interface PeopleListResult {
  section: PeopleSection;
  people: FormattedPerson[];
  count: number;
  total_piasters: number;
}

export interface DebtTransactionItem {
  id: string;
  direction: "owed_to_me" | "i_owe";
  type: "debt" | "payment";
  amount_piasters: number;
  note: string | null;
  op_id: string;
  created_at: string;
}

export interface PersonDetailsResult {
  person: FormattedPerson;
  transactions: DebtTransactionItem[];
}
