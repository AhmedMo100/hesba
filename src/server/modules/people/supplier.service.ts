import "server-only";

/**
 * @file supplier.service.ts
 * @description Suppliers (الموردين): what the store owes them and which products they supply.
 *
 * @responsibility
 * List suppliers with balances and supplied products, create (with an optional opening
 * balance and product links), view details with the running ledger, record a debt or a
 * payment, edit (including the supplied-product list), and delete.
 * A debt is `i_owe`; a payment (سداد له) is `owed_to_me`.
 *
 * @usedBy
 * `people.service.ts` (section dispatcher).
 *
 * @remarks
 * - Balances are never stored: they are recomputed from the supplier's `debt_entries` ledger
 *   (`./ledger.ts`, ADR-0023). They are SIGNED and never floored: > 0 the shop owes the
 *   supplier, < 0 the shop paid ahead (an advance the supplier owes), shown as such.
 * - Editing the balance writes one `adjustment` entry labelled as the owner's — never a debt
 *   or a payment — and only when the amount actually changes.
 * - Every ledger write locks the supplier's row; an `opId` already recorded returns that
 *   entry instead of creating a second one.
 * - Delete is a soft delete. Money is integer piasters.
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
  type SuppliedProductItem,
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

const LABELS: LedgerLabels = { debt: "مستحق له", payment: "سداد له" };
const NOT_FOUND = "المورد غير موجود أو تم حذفه";

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
          ...balanceFields("payable", supplier.debtEntries),
          note: latestNoteOf(supplier.note, supplier.debtEntries),
          supplies,
          created_at: supplier.createdAt.toISOString(),
          updated_at: supplier.updatedAt.toISOString(),
        });
      }

      formattedList.sort((a, b) => b.amount_piasters - a.amount_piasters);

      return {
        section: "suppliers",
        people: formattedList,
        count: formattedList.length,
        ...sectionTotals(formattedList),
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

      if (input.amountPiasters > 0) {
        // The opening balance the shop owes the supplier ('i_owe', ADR-0023).
        await tx.debtEntry.create({
          data: {
            storeId,
            supplierId: supplier.id,
            direction: "i_owe",
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: input.note?.trim() || null,
            opId: crypto.randomUUID(),
            entryKind: "opening",
          },
        });
      }
      const openingEntries = await tx.debtEntry.findMany({
        where: { storeId, supplierId: supplier.id },
      });

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
        ...balanceFields("payable", openingEntries),
        note: latestNoteOf(supplier.note, openingEntries),
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

      if (!supplier) throw AppError.notFound(NOT_FOUND);

      const balance = balanceFields("payable", supplier.debtEntries);
      const transactions = historyOf("payable", supplier.debtEntries, LABELS);

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
          ...balance,
          note: latestNoteOf(supplier.note, supplier.debtEntries),
          supplies,
          created_at: supplier.createdAt.toISOString(),
          updated_at: supplier.updatedAt.toISOString(),
        },
        transactions,
        summary: {
          total_original_piasters: balance.total_original_piasters ?? 0,
          total_paid_piasters: balance.total_paid_piasters ?? 0,
          remaining_piasters: balance.amount_piasters,
          credit_piasters: balance.credit_piasters ?? 0,
          is_settled: balance.is_settled ?? false,
        },
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Records a debt or a payment for a supplier (idempotent via `opId`). A payment larger than
 * what is owed leaves a visible credit — an advance the supplier owes the shop (ADR-0023).
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
    (tx) =>
      recordLedgerEntryInTx(
        tx,
        storeId,
        { table: "suppliers", supplierId },
        input,
        LABELS,
      ),
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

      if (!supplier) throw AppError.notFound(NOT_FOUND);

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
        await setLedgerBalanceInTx(
          tx,
          storeId,
          { table: "suppliers", supplierId: supplier.id },
          input.amountPiasters,
        );
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

      if (!updated) throw AppError.notFound(NOT_FOUND);

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
        ...balanceFields("payable", updated.debtEntries),
        note: latestNoteOf(updated.note, updated.debtEntries),
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

      if (!supplier)
        throw AppError.notFound("المورد غير موجود أو تم حذفه بالفعل");

      await tx.supplier.update({
        where: { id: supplier.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: supplier.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
