import "server-only";

/**
 * @file customer.service.ts
 * @description Customers who owe the store money (section "owedToMe", ليك): receivables.
 *
 * @responsibility
 * List customers with their balance, create (with an optional opening balance), view details
 * with the running ledger, record a debt or a collection, edit, and delete.
 * A debt is `owed_to_me`; a collection (تحصيل) is `i_owe`.
 *
 * @usedBy
 * `people.service.ts` (section dispatcher).
 *
 * @remarks
 * - Balances are never stored: they are recomputed from the customer's `debt_entries` ledger
 *   (`./ledger.ts`, ADR-0023). They are SIGNED and never floored: > 0 the customer owes the
 *   shop, < 0 the customer has a credit (paid more than owed), shown as such.
 * - Editing the balance writes one `adjustment` entry labelled as the owner's — never a debt
 *   or a collection — and only when the amount actually changes.
 * - Every ledger write locks the customer's row; an `opId` already recorded returns that
 *   entry. Delete is a soft delete. Money is integer piasters.
 */
import { type Prisma, type PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
import { AppError } from "@/server/platform/error";
import {
  type CreatePersonInput,
  type UpdatePersonInput,
  type RecordDebtTransactionInput,
} from "@/schemas/people";
import {
  type FormattedPerson,
  type PeopleListResult,
  type PersonDetailsResult,
  type DebtTransactionItem,
} from "./types";
import {
  balanceFields,
  historyOf,
  latestNoteOf,
  recordLedgerEntryInTx,
  sectionTotals,
  setLedgerBalanceInTx,
  type LedgerLabels,
} from "./ledger";

const LABELS: LedgerLabels = { debt: "مستحق ليك", payment: "تحصيل" };
const NOT_FOUND = "العميل غير موجود أو تم حذفه";

function formatCustomer(
  customer: {
    id: string;
    storeId: string;
    nameAr: string;
    phone: string | null;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  entries: Parameters<typeof balanceFields>[1],
): FormattedPerson {
  return {
    id: customer.id,
    store_id: customer.storeId,
    section: "owedToMe",
    kind: "customer",
    name: customer.nameAr,
    phone: customer.phone,
    ...balanceFields("receivable", entries),
    note: latestNoteOf(customer.note, entries),
    supplies: [],
    created_at: customer.createdAt.toISOString(),
    updated_at: customer.updatedAt.toISOString(),
  };
}

/**
 * Lists customers (العملاء / ليك) with their signed balances. The section total is what
 * customers owe; credits are totalled apart (`summary.total_credit_piasters`).
 */
export async function getCustomers(
  storeId: string,
  search?: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PeopleListResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const whereClause: Prisma.CustomerWhereInput = {
        storeId,
        deletedAt: null,
      };

      if (search && search.trim()) {
        const q = search.trim();
        whereClause.OR = [
          { nameAr: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ];
      }

      const customers = await tx.customer.findMany({
        where: whereClause,
        include: { debtEntries: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });

      const people = customers.map((c) => formatCustomer(c, c.debtEntries));
      people.sort((a, b) => b.amount_piasters - a.amount_piasters);

      return {
        section: "owedToMe",
        people,
        count: people.length,
        ...sectionTotals(people),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Creates a new customer with an optional opening balance (an `opening` entry).
 */
export async function createCustomer(
  storeId: string,
  input: CreatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const customer = await tx.customer.create({
        data: {
          storeId,
          nameAr: input.name.trim(),
          phone: input.phone?.trim() || null,
          note: input.note?.trim() || null,
        },
      });

      if (input.amountPiasters > 0) {
        await tx.debtEntry.create({
          data: {
            storeId,
            customerId: customer.id,
            direction: "owed_to_me",
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: input.note?.trim() || null,
            opId: crypto.randomUUID(),
            entryKind: "opening",
          },
        });
      }

      const entries = await tx.debtEntry.findMany({
        where: { storeId, customerId: customer.id },
      });
      return formatCustomer(customer, entries);
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Gets details and the full ledger for a customer (newest first, signed running balances).
 */
export async function getCustomerDetails(
  storeId: string,
  customerId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PersonDetailsResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, storeId, deletedAt: null },
        include: { debtEntries: { orderBy: { createdAt: "asc" } } },
      });
      if (!customer) throw AppError.notFound(NOT_FOUND);

      const person = formatCustomer(customer, customer.debtEntries);
      return {
        person,
        transactions: historyOf("receivable", customer.debtEntries, LABELS),
        summary: {
          total_original_piasters: person.total_original_piasters ?? 0,
          total_paid_piasters: person.total_paid_piasters ?? 0,
          remaining_piasters: person.amount_piasters,
          credit_piasters: person.credit_piasters ?? 0,
          is_settled: person.is_settled ?? false,
        },
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Records a debt or a collection for a customer (idempotent via `opId`). A collection larger
 * than the debt leaves a visible credit (ADR-0023).
 */
export async function recordCustomerTransaction(
  storeId: string,
  customerId: string,
  input: RecordDebtTransactionInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<DebtTransactionItem> {
  return await withTenant(
    storeId,
    userId ?? null,
    (tx) =>
      recordLedgerEntryInTx(
        tx,
        storeId,
        { table: "customers", customerId },
        input,
        LABELS,
      ),
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Updates customer details. When `amountPiasters` is given and differs from the current
 * balance, ONE owner `adjustment` entry sets the balance to it (ADR-0023).
 */
export async function updateCustomer(
  storeId: string,
  customerId: string,
  input: UpdatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, storeId, deletedAt: null },
      });
      if (!customer) throw AppError.notFound(NOT_FOUND);

      const updateData: Prisma.CustomerUpdateInput = {};
      if (input.name !== undefined && input.name.trim()) {
        updateData.nameAr = input.name.trim();
      }
      if (input.phone !== undefined) {
        updateData.phone = input.phone?.trim() || null;
      }
      if (input.note !== undefined) {
        updateData.note = input.note?.trim() || null;
      }
      if (Object.keys(updateData).length > 0) {
        await tx.customer.update({
          where: { id: customer.id },
          data: updateData,
        });
      }

      if (input.amountPiasters !== undefined) {
        await setLedgerBalanceInTx(
          tx,
          storeId,
          { table: "customers", customerId: customer.id },
          input.amountPiasters,
        );
      }

      const updated = await tx.customer.findFirst({
        where: { id: customer.id },
        include: { debtEntries: true },
      });
      if (!updated) throw AppError.notFound(NOT_FOUND);
      return formatCustomer(updated, updated.debtEntries);
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Soft deletes a customer while preserving all debt accounting records.
 */
export async function deleteCustomer(
  storeId: string,
  customerId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<{ success: boolean; id: string }> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, storeId, deletedAt: null },
      });
      if (!customer)
        throw AppError.notFound("العميل غير موجود أو تم حذفه بالفعل");

      await tx.customer.update({
        where: { id: customer.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: customer.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
