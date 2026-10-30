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
 * Lists payables (الالتزامات / عليك) and computes amounts the store owes.
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
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const formattedList: FormattedPerson[] = [];

      for (const payable of payables) {
        let owedToMeSum = BigInt(0);
        let iOweSum = BigInt(0);
        let latestNote: string | null = payable.note || null;

        for (const entry of payable.debtEntries) {
          if (entry.direction === "owed_to_me") {
            owedToMeSum += entry.amountPiasters;
          } else {
            iOweSum += entry.amountPiasters;
          }
          if (entry.noteAr) {
            latestNote = entry.noteAr;
          }
        }

        // For payables: what the store owes = iOweSum - owedToMeSum
        const netOwed = Math.max(0, Number(iOweSum - owedToMeSum));

        formattedList.push({
          id: payable.id,
          store_id: payable.storeId,
          section: "iOwe",
          kind: "customer",
          name: payable.nameAr,
          phone: payable.phone,
          amount_piasters: netOwed,
          note: latestNote,
          supplies: [],
          created_at: payable.createdAt.toISOString(),
          updated_at: payable.updatedAt.toISOString(),
        });
      }

      formattedList.sort((a, b) => b.amount_piasters - a.amount_piasters);

      const totalPiasters = formattedList.reduce(
        (sum, p) => sum + p.amount_piasters,
        0,
      );

      return {
        section: "iOwe",
        people: formattedList,
        count: formattedList.length,
        total_piasters: totalPiasters,
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Creates a new payable party with optional initial amount owed.
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

      let latestNote: string | null = payable.note;
      if (input.amountPiasters > 0) {
        latestNote = input.note?.trim() || null;
        const opId = crypto.randomUUID();

        // Direction for store payable is 'i_owe'
        await tx.debtEntry.create({
          data: {
            storeId,
            payableId: payable.id,
            direction: "i_owe",
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: latestNote,
            opId,
          },
        });
      }

      return {
        id: payable.id,
        store_id: payable.storeId,
        section: "iOwe",
        kind: "customer",
        name: payable.nameAr,
        phone: payable.phone,
        amount_piasters: input.amountPiasters,
        note: latestNote,
        supplies: [],
        created_at: payable.createdAt.toISOString(),
        updated_at: payable.updatedAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Gets details and transaction history for a payable party.
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
        where: {
          id: payableId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: {
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!payable) {
        throw new Error("الجهة غير موجودة أو تم حذفها");
      }

      let owedToMeSum = BigInt(0);
      let iOweSum = BigInt(0);
      let latestNote: string | null = payable.note;

      const transactions: DebtTransactionItem[] = payable.debtEntries.map(
        (entry) => {
          if (entry.direction === "owed_to_me") {
            owedToMeSum += entry.amountPiasters;
          } else {
            iOweSum += entry.amountPiasters;
          }
          if (entry.noteAr) {
            latestNote = entry.noteAr;
          }

          // For store payable: 'i_owe' is the debt incurred, 'owed_to_me' is payment made by the store
          const type = entry.direction === "i_owe" ? "debt" : "payment";

          return {
            id: entry.id,
            direction: entry.direction,
            type,
            amount_piasters: Number(entry.amountPiasters),
            note: entry.noteAr,
            op_id: entry.opId,
            created_at: entry.createdAt.toISOString(),
          };
        },
      );

      const netOwed = Math.max(0, Number(iOweSum - owedToMeSum));

      return {
        person: {
          id: payable.id,
          store_id: payable.storeId,
          section: "iOwe",
          kind: "customer",
          name: payable.nameAr,
          phone: payable.phone,
          amount_piasters: netOwed,
          note: latestNote,
          supplies: [],
          created_at: payable.createdAt.toISOString(),
          updated_at: payable.updatedAt.toISOString(),
        },
        transactions,
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Records an obligation or repayment transaction for a payable party.
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
    async (tx) => {
      const payable = await tx.payable.findFirst({
        where: {
          id: payableId,
          storeId,
          deletedAt: null,
        },
      });

      if (!payable) {
        throw new Error("الجهة غير موجودة أو تم حذفها");
      }

      const opId = input.opId || crypto.randomUUID();

      const existing = await tx.debtEntry.findFirst({
        where: {
          storeId,
          opId,
        },
      });

      if (existing) {
        const type = existing.direction === "i_owe" ? "debt" : "payment";
        return {
          id: existing.id,
          direction: existing.direction,
          type,
          amount_piasters: Number(existing.amountPiasters),
          note: existing.noteAr,
          op_id: existing.opId,
          created_at: existing.createdAt.toISOString(),
        };
      }

      // type === 'debt' -> store owes more -> 'i_owe'
      // type === 'payment' -> store paid towards the payable -> 'owed_to_me'
      const direction = input.type === "debt" ? "i_owe" : "owed_to_me";

      const created = await tx.debtEntry.create({
        data: {
          storeId,
          payableId: payable.id,
          direction,
          amountPiasters: BigInt(input.amountPiasters),
          noteAr: input.note?.trim() || null,
          opId,
        },
      });

      return {
        id: created.id,
        direction: created.direction,
        type: input.type,
        amount_piasters: Number(created.amountPiasters),
        note: created.noteAr,
        op_id: created.opId,
        created_at: created.createdAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Updates payable party details and optionally adjusts balance.
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
        where: {
          id: payableId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: true,
        },
      });

      if (!payable) {
        throw new Error("الجهة غير موجودة أو لا تملك صلاحية تعديلها");
      }

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
        let currentOwed = BigInt(0);
        let currentPaid = BigInt(0);
        for (const entry of payable.debtEntries) {
          if (entry.direction === "i_owe") {
            currentOwed += entry.amountPiasters;
          } else {
            currentPaid += entry.amountPiasters;
          }
        }
        const currentBalance = Number(currentOwed - currentPaid);
        const targetBalance = input.amountPiasters;
        const diff = targetBalance - currentBalance;

        if (diff !== 0) {
          const direction = diff > 0 ? "i_owe" : "owed_to_me";
          const adjustmentAmount = BigInt(Math.abs(diff));
          const opId = crypto.randomUUID();

          await tx.debtEntry.create({
            data: {
              storeId,
              payableId: payable.id,
              direction,
              amountPiasters: adjustmentAmount,
              noteAr: input.note?.trim() || "تعديل رصيد",
              opId,
            },
          });
        }
      }

      const updated = await tx.payable.findFirst({
        where: { id: payable.id },
        include: { debtEntries: true },
      });

      if (!updated) {
        throw new Error("فشل في استرجاع الجهة بعد التعديل");
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
        section: "iOwe",
        kind: "customer",
        name: updated.nameAr,
        phone: updated.phone,
        amount_piasters: Math.max(0, Number(iOweSum - owedToMeSum)),
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
 * Soft deletes a payable party while preserving all debt accounting records.
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
        where: {
          id: payableId,
          storeId,
          deletedAt: null,
        },
      });

      if (!payable) {
        throw new Error("الجهة غير موجودة أو تم حذفها بالفعل");
      }

      await tx.payable.update({
        where: { id: payable.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: payable.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
