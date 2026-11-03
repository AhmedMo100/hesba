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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Safely resolves raw product IDs (direct storeProduct UUIDs, global catalog "gp_<uuid>" IDs,
 * or legacy product strings) to existing or initialized storeProduct records.
 * Prevents Postgres UUID syntax errors (P2023) when non-UUID strings are passed.
 */
async function resolveSuppliedStoreProductIds(
  tx: Prisma.TransactionClient,
  storeId: string,
  rawSupplies: string[],
): Promise<Array<{ id: string; nameAr: string | null }>> {
  if (!rawSupplies || rawSupplies.length === 0) return [];

  const directUuids: string[] = [];
  const globalProductIdsToResolve: string[] = [];

  for (const raw of rawSupplies) {
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();

    if (trimmed.startsWith("gp_")) {
      const candidateGlobalId = trimmed.slice(3);
      if (UUID_REGEX.test(candidateGlobalId)) {
        globalProductIdsToResolve.push(candidateGlobalId);
      }
    } else if (UUID_REGEX.test(trimmed)) {
      directUuids.push(trimmed);
    }
  }

  const finalProductMap = new Map<
    string,
    { id: string; nameAr: string | null }
  >();

  // 1. Direct UUIDs against storeProduct
  if (directUuids.length > 0) {
    const existingStoreProducts = await tx.storeProduct.findMany({
      where: {
        storeId,
        id: { in: directUuids },
      },
      select: { id: true, nameAr: true },
    });

    for (const p of existingStoreProducts) {
      finalProductMap.set(p.id, p);
    }

    // Direct UUIDs that were not storeProduct.id might be globalProductId directly
    const remainingUuids = directUuids.filter((id) => !finalProductMap.has(id));
    for (const id of remainingUuids) {
      globalProductIdsToResolve.push(id);
    }
  }

  // 2. Resolve global products (either existing storeProduct override or create one)
  if (globalProductIdsToResolve.length > 0) {
    const uniqueGlobalIds = Array.from(new Set(globalProductIdsToResolve));

    const existingGlobalOverrides = await tx.storeProduct.findMany({
      where: {
        storeId,
        globalProductId: { in: uniqueGlobalIds },
      },
      select: { id: true, globalProductId: true, nameAr: true },
    });

    for (const sp of existingGlobalOverrides) {
      finalProductMap.set(sp.id, { id: sp.id, nameAr: sp.nameAr });
    }

    const linkedGlobalIds = new Set(
      existingGlobalOverrides
        .map((sp) => sp.globalProductId)
        .filter((gid): gid is string => gid !== null),
    );

    const uninstantiatedGlobalIds = uniqueGlobalIds.filter(
      (gid) => !linkedGlobalIds.has(gid),
    );

    if (uninstantiatedGlobalIds.length > 0) {
      const globalCatalogItems = await tx.globalProduct.findMany({
        where: { id: { in: uninstantiatedGlobalIds } },
        include: { globalVariants: true },
      });

      const now = new Date();
      for (const gp of globalCatalogItems) {
        const primaryGv = gp.globalVariants[0];
        const newStoreProduct = await tx.storeProduct.create({
          data: {
            storeId,
            globalProductId: gp.id,
            nameAr: gp.nameAr,
            nameNorm: gp.nameNorm,
            category: gp.category,
            unit:
              primaryGv?.sizeUnit === "kg" || primaryGv?.sizeUnit === "g"
                ? "kg"
                : "piece",
            sellPricePiasters: BigInt(0),
            buyPricePiasters: BigInt(0),
            isCustom: false,
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
        });

        await tx.storeVariant.create({
          data: {
            storeId,
            storeProductId: newStoreProduct.id,
            productId: gp.id,
            globalVariantId: primaryGv?.id ?? null,
            flavor: primaryGv?.flavor ?? null,
            sizeValue: primaryGv?.sizeValue ?? null,
            sizeUnit: primaryGv?.sizeUnit ?? null,
            packQty: primaryGv?.packQty ?? 1,
            sellPricePiasters: BigInt(0),
            buyPricePiasters: BigInt(0),
            isActive: true,
            createdAt: now,
            updatedAt: now,
          },
        });

        finalProductMap.set(newStoreProduct.id, {
          id: newStoreProduct.id,
          nameAr: newStoreProduct.nameAr,
        });
      }
    }
  }

  return Array.from(finalProductMap.values());
}

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

        const totalOriginal = Number(iOweSum);
        const totalPaid = Number(owedToMeSum);
        const netOwed = Math.max(0, Number(iOweSum - owedToMeSum));
        const isSettled = totalOriginal > 0 && netOwed <= 0;

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
          total_original_piasters: totalOriginal,
          total_paid_piasters: totalPaid,
          is_settled: isSettled,
          note: latestNote,
          supplies,
          created_at: supplier.createdAt.toISOString(),
          updated_at: supplier.updatedAt.toISOString(),
        });
      }

      formattedList.sort((a, b) => b.amount_piasters - a.amount_piasters);

      let totalOwedPiasters = 0;
      let totalPaidPiasters = 0;
      let totalRemainingPiasters = 0;
      let activeCount = 0;
      let settledCount = 0;

      for (const s of formattedList) {
        totalOwedPiasters += s.total_original_piasters || 0;
        totalPaidPiasters += s.total_paid_piasters || 0;
        totalRemainingPiasters += s.amount_piasters;
        if (s.amount_piasters > 0) activeCount++;
        if (s.is_settled) settledCount++;
      }

      return {
        section: "suppliers",
        people: formattedList,
        count: formattedList.length,
        total_piasters: totalRemainingPiasters,
        summary: {
          total_original_piasters: totalOwedPiasters,
          total_paid_piasters: totalPaidPiasters,
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
        const validProducts = await resolveSuppliedStoreProductIds(
          tx,
          storeId,
          input.supplies,
        );

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
      });

      if (!supplier) {
        throw new Error("المورد غير موجود أو تم حذفه");
      }

      let runningBalance = BigInt(0);
      let totalOriginalSum = BigInt(0);
      let totalPaidSum = BigInt(0);
      let latestNote: string | null = supplier.note;

      const transactions: DebtTransactionItem[] = [];

      for (const entry of supplier.debtEntries) {
        let type: "debt" | "payment";
        let actionLabel: string;

        if (entry.direction === "i_owe") {
          type = "debt";
          actionLabel = "مستحق له";
          runningBalance += entry.amountPiasters;
          totalOriginalSum += entry.amountPiasters;
        } else {
          type = "payment";
          actionLabel = "سداد له";
          runningBalance -= entry.amountPiasters;
          totalPaidSum += entry.amountPiasters;
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
      const totalPaid = Number(totalPaidSum);
      const isSettled = totalOriginal > 0 && remainingPiasters <= 0;

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
          amount_piasters: remainingPiasters,
          total_original_piasters: totalOriginal,
          total_paid_piasters: totalPaid,
          is_settled: isSettled,
          note: latestNote,
          supplies,
          created_at: supplier.createdAt.toISOString(),
          updated_at: supplier.updatedAt.toISOString(),
        },
        transactions,
        summary: {
          total_original_piasters: totalOriginal,
          total_paid_piasters: totalPaid,
          remaining_piasters: remainingPiasters,
          is_settled: isSettled,
        },
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
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
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
        const actionLabel =
          existing.direction === "i_owe" ? "مستحق له" : "سداد له";

        let bal = BigInt(0);
        for (const e of supplier.debtEntries) {
          if (e.direction === "i_owe") bal += e.amountPiasters;
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

      // type === 'debt' -> more owed to supplier -> 'i_owe'
      // type === 'payment' -> payment to supplier -> 'owed_to_me'
      const direction = input.type === "debt" ? "i_owe" : "owed_to_me";
      const actionLabel = input.type === "debt" ? "مستحق له" : "سداد له";

      const created = await tx.debtEntry.create({
        data: {
          storeId,
          supplierId: supplier.id,
          direction,
          amountPiasters: BigInt(input.amountPiasters),
          noteAr: input.note?.trim() || null,
          opId,
          createdAt: input.date ?? new Date(),
        },
      });

      let currentBal = BigInt(0);
      for (const e of supplier.debtEntries) {
        if (e.direction === "i_owe") currentBal += e.amountPiasters;
        else currentBal -= e.amountPiasters;
      }
      if (direction === "i_owe") currentBal += created.amountPiasters;
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
          const validProducts = await resolveSuppliedStoreProductIds(
            tx,
            storeId,
            input.supplies,
          );

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
