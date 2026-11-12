import "server-only";

/**
 * @file payable.service.ts
 * @description People the store owes money to who are not suppliers (section "iOwe",
 * عليك): payables.
 *
 * @responsibility
 * List with balances, create (with an optional opening balance), view details with the
 * running ledger, record a debt or a payment, edit, and delete.
 * A debt is `i_owe`; a payment (سداد) is `owed_to_me`.
 *
 * @usedBy
 * `people.service.ts` (section dispatcher).
 *
 * @remarks
 * - Balances are never stored: they are recomputed from the payable's `debt_entries` ledger
 *   (`./ledger.ts`, ADR-0023). They are SIGNED and never floored: > 0 the shop owes them,
 *   < 0 the shop paid more than it owed (they owe the shop that credit), shown as such.
 * - Editing the balance writes one `adjustment` entry labelled as the owner's — never a debt
 *   or a collection — and only when the amount actually changes.
 * - Every ledger write locks the payable's row; an `opId` already recorded returns that
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

const LABELS: LedgerLabels = { debt: "مستحق عليك", payment: "سداد" };
const NOT_FOUND = "الجهة غير موجودة أو تم حذفها";

function formatPayable(
  payable: {
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
    id: payable.id,
    store_id: payable.storeId,
    section: "iOwe",
    kind: "customer",
    name: payable.nameAr,
    phone: payable.phone,
    ...balanceFields("payable", entries),
    note: latestNoteOf(payable.note, entries),
    supplies: [],
    created_at: payable.createdAt.toISOString(),
    updated_at: payable.updatedAt.toISOString(),
  };
}

/**
 * Lists payables (الالتزامات / عليك) with their signed balances. The section total is what
 * the shop owes; credits are totalled apart (`summary.total_credit_piasters`).
 */
export async function getPayables(
  storeId: string,
  search?: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PeopleListResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const whereClause: Prisma.PayableWhereInput = {
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

      const payables = await tx.payable.findMany({
        where: whereClause,
        include: { debtEntries: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      });

      const people = payables.map((c) => formatPayable(c, c.debtEntries));
      people.sort((a, b) => b.amount_piasters - a.amount_piasters);

      return {
        section: "iOwe",
        people,
        count: people.length,
        ...sectionTotals(people),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Creates a new payable party with an optional opening balance (an `opening` entry).
 */
export async function createPayable(
  storeId: string,
  input: CreatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const payable = await tx.payable.create({
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
            payableId: payable.id,
            direction: "i_owe",
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: input.note?.trim() || null,
            opId: crypto.randomUUID(),
            entryKind: "opening",
          },
        });
      }

      const entries = await tx.debtEntry.findMany({
        where: { storeId, payableId: payable.id },
      });
      return formatPayable(payable, entries);
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Gets details and the full ledger for a payable (newest first, signed running balances).
 */
export async function getPayableDetails(
  storeId: string,
  payableId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PersonDetailsResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const payable = await tx.payable.findFirst({
        where: { id: payableId, storeId, deletedAt: null },
        include: { debtEntries: { orderBy: { createdAt: "asc" } } },
      });
      if (!payable) throw AppError.notFound(NOT_FOUND);

      const person = formatPayable(payable, payable.debtEntries);
      return {
        person,
        transactions: historyOf("payable", payable.debtEntries, LABELS),
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
 * Records a debt or a payment for a payable party (idempotent via `opId`). A payment larger
 * than what is owed leaves a visible credit (ADR-0023).
 */
export async function recordPayableTransaction(
  storeId: string,
  payableId: string,
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
        { table: "payables", payableId },
        input,
        LABELS,
      ),
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Updates payable details. When `amountPiasters` is given and differs from the current
 * balance, ONE owner `adjustment` entry sets the balance to it (ADR-0023).
 */
export async function updatePayable(
  storeId: string,
  payableId: string,
  input: UpdatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const payable = await tx.payable.findFirst({
        where: { id: payableId, storeId, deletedAt: null },
      });
      if (!payable) throw AppError.notFound(NOT_FOUND);

      const updateData: Prisma.PayableUpdateInput = {};
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
        await tx.payable.update({
          where: { id: payable.id },
          data: updateData,
        });
      }

      if (input.amountPiasters !== undefined) {
        await setLedgerBalanceInTx(
          tx,
          storeId,
          { table: "payables", payableId: payable.id },
          input.amountPiasters,
        );
      }

      const updated = await tx.payable.findFirst({
        where: { id: payable.id },
        include: { debtEntries: true },
      });
      if (!updated) throw AppError.notFound(NOT_FOUND);
      return formatPayable(updated, updated.debtEntries);
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Soft deletes a payable while preserving all debt accounting records.
 */
export async function deletePayable(
  storeId: string,
  payableId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<{ success: boolean; id: string }> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const payable = await tx.payable.findFirst({
        where: { id: payableId, storeId, deletedAt: null },
      });
      if (!payable)
        throw AppError.notFound("الجهة غير موجودة أو تم حذفها بالفعل");

      await tx.payable.update({
        where: { id: payable.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: payable.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
