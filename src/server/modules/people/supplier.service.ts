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
  type SuppliedProductItem,
} from "./types";

/**
 * Lists suppliers (الموردين) and computes their owed balances and supplied products.
 */
export async function getSuppliers(
  storeId: string,
  search?: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PeopleListResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const whereClause: Prisma.SupplierWhereInput = {
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

      const suppliers = await tx.supplier.findMany({
        where: whereClause,
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
          suppliedProducts: {
            include: {
              storeProduct: {
                select: { id: true, nameAr: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const formattedList: FormattedPerson[] = [];

      for (const supplier of suppliers) {
        let owedToMeSum = BigInt(0);
        let iOweSum = BigInt(0);
        let latestNote: string | null = supplier.note || null;

        for (const entry of supplier.debtEntries) {
          if (entry.direction === "owed_to_me") {
            owedToMeSum += entry.amountPiasters;
          } else {
            iOweSum += entry.amountPiasters;
          }
          if (entry.noteAr) {
            latestNote = entry.noteAr;
          }
        }

        // Amount remaining owed to supplier = max(0, iOweSum - owedToMeSum)
        const netOwed = Math.max(0, Number(iOweSum - owedToMeSum));

        const supplies: SuppliedProductItem[] = supplier.suppliedProducts
          .filter((sp) => sp.storeProduct !== null)
          .map((sp) => ({
            id: sp.storeProduct.id,
            name: sp.storeProduct.nameAr || "—",
          }));

        formattedList.push({
          id: supplier.id,
          store_id: supplier.storeId,
          section: "suppliers",
          kind: "supplier",
          name: supplier.nameAr,
          phone: supplier.phone,
          amount_piasters: netOwed,
          note: latestNote,
          supplies,
          created_at: supplier.createdAt.toISOString(),
          updated_at: supplier.updatedAt.toISOString(),
        });
      }

      formattedList.sort((a, b) => b.amount_piasters - a.amount_piasters);

      const totalPiasters = formattedList.reduce(
        (sum, p) => sum + p.amount_piasters,
        0,
      );

      return {
        section: "suppliers",
        people: formattedList,
        count: formattedList.length,
        total_piasters: totalPiasters,
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Creates a new supplier with optional initial balance and supplied products.
 */
export async function createSupplier(
  storeId: string,
  input: CreatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          storeId,
          nameAr: input.name.trim(),
          phone: input.phone?.trim() || null,
          note: input.note?.trim() || null,
        },
      });

      let latestNote: string | null = supplier.note;
      if (input.amountPiasters > 0) {
        latestNote = input.note?.trim() || null;
        const opId = crypto.randomUUID();

        // Direction for supplier balance owed by store is 'i_owe'
        await tx.debtEntry.create({
          data: {
            storeId,
            supplierId: supplier.id,
            direction: "i_owe",
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: latestNote,
            opId,
          },
        });
      }

      const supplies: SuppliedProductItem[] = [];
      if (input.supplies && input.supplies.length > 0) {
        const validProducts = await tx.storeProduct.findMany({
          where: {
            storeId,
            id: { in: input.supplies },
          },
          select: { id: true, nameAr: true },
        });

        if (validProducts.length > 0) {
          await tx.supplierProduct.createMany({
            data: validProducts.map((p) => ({
              storeId,
              supplierId: supplier.id,
              storeProductId: p.id,
            })),
            skipDuplicates: true,
          });

          for (const p of validProducts) {
            supplies.push({ id: p.id, name: p.nameAr || "—" });
          }
        }
      }

      return {
        id: supplier.id,
        store_id: supplier.storeId,
        section: "suppliers",
        kind: "supplier",
        name: supplier.nameAr,
        phone: supplier.phone,
        amount_piasters: input.amountPiasters,
        note: latestNote,
        supplies,
        created_at: supplier.createdAt.toISOString(),
        updated_at: supplier.updatedAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Gets details, transactions, and supplied products for a supplier.
 */
export async function getSupplierDetails(
  storeId: string,
  supplierId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PersonDetailsResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: {
            orderBy: { createdAt: "desc" },
          },
          suppliedProducts: {
            include: {
              storeProduct: {
                select: { id: true, nameAr: true },
              },
            },
          },
        },
      });

      if (!supplier) {
        throw new Error("المورد غير موجود أو تم حذفه");
      }

      let owedToMeSum = BigInt(0);
      let iOweSum = BigInt(0);
      let latestNote: string | null = supplier.note;

      const transactions: DebtTransactionItem[] = supplier.debtEntries.map(
        (entry) => {
          if (entry.direction === "owed_to_me") {
            owedToMeSum += entry.amountPiasters;
          } else {
            iOweSum += entry.amountPiasters;
          }
          if (entry.noteAr) {
            latestNote = entry.noteAr;
          }

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

      const supplies: SuppliedProductItem[] = supplier.suppliedProducts
        .filter((sp) => sp.storeProduct !== null)
        .map((sp) => ({
          id: sp.storeProduct.id,
          name: sp.storeProduct.nameAr || "—",
        }));

      return {
        person: {
          id: supplier.id,
          store_id: supplier.storeId,
          section: "suppliers",
          kind: "supplier",
          name: supplier.nameAr,
          phone: supplier.phone,
          amount_piasters: netOwed,
          note: latestNote,
          supplies,
          created_at: supplier.createdAt.toISOString(),
          updated_at: supplier.updatedAt.toISOString(),
        },
        transactions,
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Records a debt or payment transaction for a supplier (idempotent via opId).
 */
export async function recordSupplierTransaction(
  storeId: string,
  supplierId: string,
  input: RecordDebtTransactionInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<DebtTransactionItem> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          storeId,
          deletedAt: null,
        },
      });

      if (!supplier) {
        throw new Error("المورد غير موجود أو تم حذفه");
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

      // type === 'debt' -> more owed to supplier -> 'i_owe'
      // type === 'payment' -> payment to supplier -> 'owed_to_me'
      const direction = input.type === "debt" ? "i_owe" : "owed_to_me";

      const created = await tx.debtEntry.create({
        data: {
          storeId,
          supplierId: supplier.id,
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
 * Updates supplier details, supplied products, and optionally adjusts balance.
 */
export async function updateSupplier(
  storeId: string,
  supplierId: string,
  input: UpdatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          storeId,
          deletedAt: null,
        },
        include: {
          debtEntries: true,
          suppliedProducts: true,
        },
      });

      if (!supplier) {
        throw new Error("المورد غير موجود أو لا تملك صلاحية تعديله");
      }

      const updateData: Prisma.SupplierUpdateInput = {};
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
        await tx.supplier.update({
          where: { id: supplier.id },
          data: updateData,
        });
      }

      if (input.supplies !== undefined) {
        await tx.supplierProduct.deleteMany({
          where: { supplierId: supplier.id },
        });

        if (input.supplies.length > 0) {
          const validProducts = await tx.storeProduct.findMany({
            where: {
              storeId,
              id: { in: input.supplies },
            },
            select: { id: true },
          });

          if (validProducts.length > 0) {
            await tx.supplierProduct.createMany({
              data: validProducts.map((p) => ({
                storeId,
                supplierId: supplier.id,
                storeProductId: p.id,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      if (input.amountPiasters !== undefined) {
        let currentOwed = BigInt(0);
        let currentPaid = BigInt(0);
        for (const entry of supplier.debtEntries) {
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
              supplierId: supplier.id,
              direction,
              amountPiasters: adjustmentAmount,
              noteAr: input.note?.trim() || "تعديل رصيد",
              opId,
            },
          });
        }
      }

      const updated = await tx.supplier.findFirst({
        where: { id: supplier.id },
        include: {
          debtEntries: true,
          suppliedProducts: {
            include: {
              storeProduct: {
                select: { id: true, nameAr: true },
              },
            },
          },
        },
      });

      if (!updated) {
        throw new Error("فشل في استرجاع المورد بعد التعديل");
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

      const supplies: SuppliedProductItem[] = updated.suppliedProducts
        .filter((sp) => sp.storeProduct !== null)
        .map((sp) => ({
          id: sp.storeProduct.id,
          name: sp.storeProduct.nameAr || "—",
        }));

      return {
        id: updated.id,
        store_id: updated.storeId,
        section: "suppliers",
        kind: "supplier",
        name: updated.nameAr,
        phone: updated.phone,
        amount_piasters: Math.max(0, Number(iOweSum - owedToMeSum)),
        note: latestNote,
        supplies,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Soft deletes a supplier while preserving all debt and purchase accounting records.
 */
export async function deleteSupplier(
  storeId: string,
  supplierId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<{ success: boolean; id: string }> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: {
          id: supplierId,
          storeId,
          deletedAt: null,
        },
      });

      if (!supplier) {
        throw new Error("المورد غير موجود أو تم حذفه بالفعل");
      }

      await tx.supplier.update({
        where: { id: supplier.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: supplier.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
