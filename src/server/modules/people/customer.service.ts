import "server-only";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
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

/**
 * Lists customers (العملاء / ليك) and computes their receivable balances.
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
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const formattedList: FormattedPerson[] = [];

      for (const customer of customers) {
        let owedToMeSum = BigInt(0);
        let iOweSum = BigInt(0);
        let latestNote: string | null = customer.note || null;

        for (const entry of customer.debtEntries) {
          if (entry.direction === "owed_to_me") {
            owedToMeSum += entry.amountPiasters;
          } else {
            iOweSum += entry.amountPiasters;
          }
          if (entry.noteAr) {
            latestNote = entry.noteAr;
          }
        }

        const totalOriginal = Number(owedToMeSum);
        const totalPaid = Number(iOweSum);
        const netBalance = Math.max(0, Number(owedToMeSum - iOweSum));
        const isSettled = totalOriginal > 0 && netBalance <= 0;

        formattedList.push({
          id: customer.id,
          store_id: customer.storeId,
          section: "owedToMe",
          kind: "customer",
          name: customer.nameAr,
          phone: customer.phone,
          amount_piasters: netBalance,
          total_original_piasters: totalOriginal,
          total_paid_piasters: totalPaid,
          is_settled: isSettled,
          note: latestNote,
          supplies: [],
          created_at: customer.createdAt.toISOString(),
          updated_at: customer.updatedAt.toISOString(),
        });
      }

      formattedList.sort((a, b) => b.amount_piasters - a.amount_piasters);

      let totalOriginalPiasters = 0;
      let totalCollectedPiasters = 0;
      let totalRemainingPiasters = 0;
      let activeCount = 0;
      let settledCount = 0;

      for (const p of formattedList) {
        totalOriginalPiasters += p.total_original_piasters || 0;
        totalCollectedPiasters += p.total_paid_piasters || 0;
        totalRemainingPiasters += p.amount_piasters;
        if (p.amount_piasters > 0) activeCount++;
        if (p.is_settled) settledCount++;
      }

      return {
        section: "owedToMe",
        people: formattedList,
        count: formattedList.length,
        total_piasters: totalRemainingPiasters,
        summary: {
          total_original_piasters: totalOriginalPiasters,
          total_paid_piasters: totalCollectedPiasters,
          total_remaining_piasters: totalRemainingPiasters,
          total_count: formattedList.length,
          active_count: activeCount,
          settled_count: settledCount,
        },
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Creates a new customer with optional initial receivable balance.
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

      let latestNote: string | null = customer.note;
      if (input.amountPiasters > 0) {
        latestNote = input.note?.trim() || null;
        const opId = crypto.randomUUID();

        await tx.debtEntry.create({
          data: {
            storeId,
            customerId: customer.id,
            direction: "owed_to_me",
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: latestNote,
            opId,
          },
        });
      }

      return {
        id: customer.id,
        store_id: customer.storeId,
        section: "owedToMe",
        kind: "customer",
        name: customer.nameAr,
        phone: customer.phone,
        amount_piasters: input.amountPiasters,
        note: latestNote,
        supplies: [],
        created_at: customer.createdAt.toISOString(),
        updated_at: customer.updatedAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Gets details and transaction history for a customer.
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
        where: {
          id: customerId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!customer) {
        throw new Error("العميل غير موجود أو تم حذفه");
      }

      let runningBalance = BigInt(0);
      let totalOriginalSum = BigInt(0);
      let totalCollectedSum = BigInt(0);
      let latestNote: string | null = customer.note;

      const transactions: DebtTransactionItem[] = [];

      for (const entry of customer.debtEntries) {
        let type: "debt" | "payment";
        let actionLabel: string;

        if (entry.direction === "owed_to_me") {
          type = "debt";
          actionLabel = "مستحق ليك";
          runningBalance += entry.amountPiasters;
          totalOriginalSum += entry.amountPiasters;
        } else {
          type = "payment";
          actionLabel = "تحصيل";
          runningBalance -= entry.amountPiasters;
          totalCollectedSum += entry.amountPiasters;
        }

        if (entry.noteAr) {
          latestNote = entry.noteAr;
        }

        transactions.push({
          id: entry.id,
          direction: entry.direction,
          type,
          action_label: actionLabel,
          amount_piasters: Number(entry.amountPiasters),
          balance_after_piasters: Math.max(0, Number(runningBalance)),
          note: entry.noteAr,
          op_id: entry.opId,
          created_at: entry.createdAt.toISOString(),
        });
      }

      transactions.reverse();

      const remainingPiasters = Math.max(0, Number(runningBalance));
      const totalOriginal = Number(totalOriginalSum);
      const totalCollected = Number(totalCollectedSum);
      const isSettled = totalOriginal > 0 && remainingPiasters <= 0;

      return {
        person: {
          id: customer.id,
          store_id: customer.storeId,
          section: "owedToMe",
          kind: "customer",
          name: customer.nameAr,
          phone: customer.phone,
          amount_piasters: remainingPiasters,
          total_original_piasters: totalOriginal,
          total_paid_piasters: totalCollected,
          is_settled: isSettled,
          note: latestNote,
          supplies: [],
          created_at: customer.createdAt.toISOString(),
          updated_at: customer.updatedAt.toISOString(),
        },
        transactions,
        summary: {
          total_original_piasters: totalOriginal,
          total_paid_piasters: totalCollected,
          remaining_piasters: remainingPiasters,
          is_settled: isSettled,
        },
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Records a debt or payment transaction for a customer (idempotent via opId).
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
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: {
          id: customerId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!customer) {
        throw new Error("العميل غير موجود أو تم حذفه");
      }

      const opId = input.opId || crypto.randomUUID();

      const existing = await tx.debtEntry.findFirst({
        where: {
          storeId,
          opId,
        },
      });

      if (existing) {
        const type = existing.direction === "owed_to_me" ? "debt" : "payment";
        const actionLabel =
          existing.direction === "owed_to_me" ? "مستحق ليك" : "تحصيل";

        let bal = BigInt(0);
        for (const e of customer.debtEntries) {
          if (e.direction === "owed_to_me") bal += e.amountPiasters;
          else bal -= e.amountPiasters;
          if (e.id === existing.id) break;
        }

        return {
          id: existing.id,
          direction: existing.direction,
          type,
          action_label: actionLabel,
          amount_piasters: Number(existing.amountPiasters),
          balance_after_piasters: Math.max(0, Number(bal)),
          note: existing.noteAr,
          op_id: existing.opId,
          created_at: existing.createdAt.toISOString(),
        };
      }

      const direction = input.type === "debt" ? "owed_to_me" : "i_owe";
      const actionLabel = input.type === "debt" ? "مستحق ليك" : "تحصيل";

      const created = await tx.debtEntry.create({
        data: {
          storeId,
          customerId: customer.id,
          direction,
          amountPiasters: BigInt(input.amountPiasters),
          noteAr: input.note?.trim() || null,
          opId,
          createdAt: input.date ?? new Date(),
        },
      });

      let currentBal = BigInt(0);
      for (const e of customer.debtEntries) {
        if (e.direction === "owed_to_me") currentBal += e.amountPiasters;
        else currentBal -= e.amountPiasters;
      }
      if (direction === "owed_to_me") currentBal += created.amountPiasters;
      else currentBal -= created.amountPiasters;

      return {
        id: created.id,
        direction: created.direction,
        type: input.type,
        action_label: actionLabel,
        amount_piasters: Number(created.amountPiasters),
        balance_after_piasters: Math.max(0, Number(currentBal)),
        note: created.noteAr,
        op_id: created.opId,
        created_at: created.createdAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Updates customer details and optionally adjusts balance.
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
        where: {
          id: customerId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: true,
        },
      });

      if (!customer) {
        throw new Error("العميل غير موجود أو لا تملك صلاحية تعديله");
      }

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
        let currentOwed = BigInt(0);
        let currentPaid = BigInt(0);
        for (const entry of customer.debtEntries) {
          if (entry.direction === "owed_to_me") {
            currentOwed += entry.amountPiasters;
          } else {
            currentPaid += entry.amountPiasters;
          }
        }
        const currentBalance = Number(currentOwed - currentPaid);
        const targetBalance = input.amountPiasters;
        const diff = targetBalance - currentBalance;

        if (diff !== 0) {
          const direction = diff > 0 ? "owed_to_me" : "i_owe";
          const adjustmentAmount = BigInt(Math.abs(diff));
          const opId = crypto.randomUUID();

          await tx.debtEntry.create({
            data: {
              storeId,
              customerId: customer.id,
              direction,
              amountPiasters: adjustmentAmount,
              noteAr: input.note?.trim() || "تعديل رصيد",
              opId,
            },
          });
        }
      }

      const updated = await tx.customer.findFirst({
        where: { id: customer.id },
        include: { debtEntries: true },
      });

      if (!updated) {
        throw new Error("فشل في استرجاع العميل بعد التعديل");
      }

      let owedToMeSum = BigInt(0);
      let iOweSum = BigInt(0);
      let latestNote: string | null = updated.note;

      for (const entry of updated.debtEntries) {
        if (entry.direction === "owed_to_me") {
          owedToMeSum += entry.amountPiasters;
        } else {
          iOweSum += entry.amountPiasters;
        }
        if (entry.noteAr) {
          latestNote = entry.noteAr;
        }
      }

      return {
        id: updated.id,
        store_id: updated.storeId,
        section: "owedToMe",
        kind: "customer",
        name: updated.nameAr,
        phone: updated.phone,
        amount_piasters: Number(owedToMeSum - iOweSum),
        note: latestNote,
        supplies: [],
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
      };
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
        where: {
          id: customerId,
          storeId,
          deletedAt: null,
        },
      });

      if (!customer) {
        throw new Error("العميل غير موجود أو تم حذفه بالفعل");
      }

      await tx.customer.update({
        where: { id: customer.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: customer.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
