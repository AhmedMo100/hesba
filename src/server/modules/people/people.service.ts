import "server-only";
import { type PrismaClient } from "@prisma/client";
import {
  type CreatePersonInput,
  type UpdatePersonInput,
  type RecordDebtTransactionInput,
  type PeopleSection,
} from "@/schemas/people";
import {
  type FormattedPerson,
  type PeopleListResult,
  type PersonDetailsResult,
  type DebtTransactionItem,
  type SuppliedProductItem,
} from "./types";
import {
  getCustomers,
  createCustomer,
  getCustomerDetails,
  updateCustomer,
  deleteCustomer,
  recordCustomerTransaction,
} from "./customer.service";
import {
  getPayables,
  createPayable,
  getPayableDetails,
  updatePayable,
  deletePayable,
  recordPayableTransaction,
} from "./payable.service";
import {
  getSuppliers,
  createSupplier,
  getSupplierDetails,
  updateSupplier,
  deleteSupplier,
  recordSupplierTransaction,
} from "./supplier.service";

export type {
  FormattedPerson,
  PeopleListResult,
  PersonDetailsResult,
  DebtTransactionItem,
  SuppliedProductItem,
};

export {
  getCustomers,
  createCustomer,
  getCustomerDetails,
  updateCustomer,
  deleteCustomer,
  recordCustomerTransaction,
  getPayables,
  createPayable,
  getPayableDetails,
  updatePayable,
  deletePayable,
  recordPayableTransaction,
  getSuppliers,
  createSupplier,
  getSupplierDetails,
  updateSupplier,
  deleteSupplier,
  recordSupplierTransaction,
};

/**
 * Lists contacts and balances for a given section (owedToMe, iOwe, suppliers).
 * Completely routed to the independent table for that section.
 */
export async function getPeopleBySection(
  storeId: string,
  section: PeopleSection,
  search?: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PeopleListResult> {
  if (section === "owedToMe") {
    return await getCustomers(storeId, search, userId, customPrisma);
  }
  if (section === "iOwe") {
    return await getPayables(storeId, search, userId, customPrisma);
  }
  return await getSuppliers(storeId, search, userId, customPrisma);
}

/**
 * Creates a new customer, payable party, or supplier with optional initial balance.
 */
export async function createPerson(
  storeId: string,
  input: CreatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  if (input.section === "owedToMe") {
    return await createCustomer(storeId, input, userId, customPrisma);
  }
  if (input.section === "iOwe") {
    return await createPayable(storeId, input, userId, customPrisma);
  }
  return await createSupplier(storeId, input, userId, customPrisma);
}

/**
 * Gets details and transaction history for a person or supplier.
 */
export async function getPersonDetails(
  storeId: string,
  personId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PersonDetailsResult> {
  try {
    return await getCustomerDetails(storeId, personId, userId, customPrisma);
  } catch {}
  try {
    return await getPayableDetails(storeId, personId, userId, customPrisma);
  } catch {}
  try {
    return await getSupplierDetails(storeId, personId, userId, customPrisma);
  } catch {}

  throw new Error("الشخص أو المورد غير موجود أو تم حذفه");
}

/**
 * Updates person or supplier details and optionally adjusts balance.
 */
export async function updatePerson(
  storeId: string,
  personId: string,
  input: UpdatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  try {
    return await updateCustomer(storeId, personId, input, userId, customPrisma);
  } catch {}
  try {
    return await updatePayable(storeId, personId, input, userId, customPrisma);
  } catch {}
  try {
    return await updateSupplier(storeId, personId, input, userId, customPrisma);
  } catch {}

  throw new Error("الشخص أو المورد غير موجود أو لا تملك صلاحية تعديله");
}

/**
 * Soft deletes a person or supplier while preserving all debt accounting records.
 */
export async function deletePerson(
  storeId: string,
  personId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<{ success: boolean; id: string }> {
  try {
    return await deleteCustomer(storeId, personId, userId, customPrisma);
  } catch {}
  try {
    return await deletePayable(storeId, personId, userId, customPrisma);
  } catch {}
  try {
    return await deleteSupplier(storeId, personId, userId, customPrisma);
  } catch {}

  throw new Error("الشخص أو المورد غير موجود أو تم حذفه بالفعل");
}

/**
 * Records a debt or payment transaction for a customer, payable, or supplier.
 */
export async function recordDebtTransaction(
  storeId: string,
  personId: string,
  input: RecordDebtTransactionInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<DebtTransactionItem> {
  try {
    return await recordCustomerTransaction(
      storeId,
      personId,
      input,
      userId,
      customPrisma,
    );
  } catch {}
  try {
    return await recordPayableTransaction(
      storeId,
      personId,
      input,
      userId,
      customPrisma,
    );
  } catch {}
  try {
    return await recordSupplierTransaction(
      storeId,
      personId,
      input,
      userId,
      customPrisma,
    );
  } catch {}

  throw new Error("الشخص أو المورد غير موجود أو تم حذفه");
}
