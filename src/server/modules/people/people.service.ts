import "server-only";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
import {
  type CreatePersonInput,
  type UpdatePersonInput,
  type RecordDebtTransactionInput,
  type PeopleSection,
} from "@/schemas/people";

export interface SuppliedProductItem {
  id: string;
  name: string;
}

export interface FormattedPerson {
  id: string;
  store_id: string;
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

/**
 * Lists contacts and balances for a given section (owedToMe, iOwe, suppliers).
 */
export async function getPeopleBySection(
  storeId: string,
  section: PeopleSection,
  search?: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PeopleListResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      // 1. Determine contact kinds to query based on section
      let kindFilter: Prisma.ContactWhereInput["kind"];
      if (section === "suppliers") {
        kindFilter = { in: ["supplier", "both"] };
      } else {
        // owedToMe or iOwe: customers or general contacts
        kindFilter = { in: ["customer", "both"] };
      }

      const whereClause: Prisma.ContactWhereInput = {
        storeId,
        deletedAt: null,
        kind: kindFilter,
      };

      if (search && search.trim()) {
        const q = search.trim();
        whereClause.OR = [
          { nameAr: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ];
      }

      // 2. Fetch contacts with their debt entries and supplied products
      const contacts = await tx.contact.findMany({
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

      // 3. Compute balances per contact
      const formattedList: FormattedPerson[] = [];

      for (const contact of contacts) {
        let owedToMeSum = BigInt(0);
        let iOweSum = BigInt(0);
        let latestNote: string | null = null;

        for (const entry of contact.debtEntries) {
          if (entry.direction === "owed_to_me") {
            owedToMeSum += entry.amountPiasters;
          } else {
            iOweSum += entry.amountPiasters;
          }
          if (entry.noteAr) {
            latestNote = entry.noteAr;
          }
        }

        let amountPiasters = 0;
        let belongsToSection = false;

        if (section === "owedToMe") {
          const net = owedToMeSum - iOweSum;
          amountPiasters = Number(net);
          // Show if customer owes the store (> 0) or if they were added specifically with 0 balance
          if (
            amountPiasters > 0 ||
            (contact.debtEntries.length === 0 && contact.kind !== "supplier")
          ) {
            belongsToSection = true;
          }
        } else if (section === "iOwe") {
          const net = iOweSum - owedToMeSum;
          amountPiasters = Number(net);
          // Show if store owes the person (> 0) and person is not a dedicated supplier
          if (
            amountPiasters > 0 ||
            (contact.debtEntries.length > 0 && iOweSum > owedToMeSum)
          ) {
            belongsToSection = true;
          }
        } else {
          // suppliers
          const net = iOweSum - owedToMeSum;
          amountPiasters = Math.max(0, Number(net));
          belongsToSection = true;
        }

        if (belongsToSection) {
          const supplies: SuppliedProductItem[] = contact.suppliedProducts
            .filter((sp) => sp.storeProduct !== null)
            .map((sp) => ({
              id: sp.storeProduct.id,
              name: sp.storeProduct.nameAr || "—",
            }));

          formattedList.push({
            id: contact.id,
            store_id: contact.storeId,
            kind: contact.kind,
            name: contact.nameAr,
            phone: contact.phone,
            amount_piasters: amountPiasters,
            note: latestNote,
            supplies,
            created_at: contact.createdAt.toISOString(),
            updated_at: contact.updatedAt.toISOString(),
          });
        }
      }

      // Sort by amount descending
      formattedList.sort((a, b) => b.amount_piasters - a.amount_piasters);

      const totalPiasters = formattedList.reduce(
        (sum, p) => sum + p.amount_piasters,
        0,
      );

      return {
        section,
        people: formattedList,
        count: formattedList.length,
        total_piasters: totalPiasters,
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Creates a new person / supplier with optional initial debt and supplied products.
 */
export async function createPerson(
  storeId: string,
  input: CreatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const isSupplier = input.section === "suppliers";
      const kind = isSupplier ? "supplier" : "customer";

      // 1. Create Contact
      const contact = await tx.contact.create({
        data: {
          storeId,
          kind,
          nameAr: input.name.trim(),
          phone: input.phone?.trim() || null,
        },
      });

      // 2. If initial amount > 0, create initial DebtEntry
      let latestNote: string | null = null;
      if (input.amountPiasters > 0) {
        const direction = input.section === "owedToMe" ? "owed_to_me" : "i_owe";
        latestNote = input.note?.trim() || null;
        const opId = crypto.randomUUID();

        await tx.debtEntry.create({
          data: {
            storeId,
            contactId: contact.id,
            direction,
            amountPiasters: BigInt(input.amountPiasters),
            noteAr: latestNote,
            opId,
          },
        });
      }

      // 3. For suppliers, link supplied products
      const supplies: SuppliedProductItem[] = [];
      if (isSupplier && input.supplies && input.supplies.length > 0) {
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
              supplierId: contact.id,
              storeProductId: p.id,
            })),
            skipDuplicates: true,
          });

          for (const vp of validProducts) {
            supplies.push({
              id: vp.id,
              name: vp.nameAr || "—",
            });
          }
        }
      }

      return {
        id: contact.id,
        store_id: contact.storeId,
        kind: contact.kind,
        name: contact.nameAr,
        phone: contact.phone,
        amount_piasters: input.amountPiasters,
        note: latestNote,
        supplies,
        created_at: contact.createdAt.toISOString(),
        updated_at: contact.updatedAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Gets details of a contact including chronological transaction history.
 */
export async function getPersonDetails(
  storeId: string,
  contactId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<PersonDetailsResult> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, storeId, deletedAt: null },
        include: {
          debtEntries: {
            orderBy: { createdAt: "asc" },
          },
          suppliedProducts: {
            include: {
              storeProduct: { select: { id: true, nameAr: true } },
            },
          },
        },
      });

      if (!contact) {
        throw new Error("الشخص أو المورد غير موجود أو تم حذفه");
      }

      let owedToMeSum = BigInt(0);
      let iOweSum = BigInt(0);
      let latestNote: string | null = null;

      const transactions: DebtTransactionItem[] = [];

      for (const entry of contact.debtEntries) {
        if (entry.direction === "owed_to_me") {
          owedToMeSum += entry.amountPiasters;
        } else {
          iOweSum += entry.amountPiasters;
        }
        if (entry.noteAr) {
          latestNote = entry.noteAr;
        }

        // Determine friendly transaction type
        let type: "debt" | "payment" = "debt";
        if (contact.kind === "supplier") {
          type = entry.direction === "owed_to_me" ? "payment" : "debt";
        } else {
          // customer
          type = entry.direction === "i_owe" ? "payment" : "debt";
        }

        transactions.push({
          id: entry.id,
          direction: entry.direction,
          type,
          amount_piasters: Number(entry.amountPiasters),
          note: entry.noteAr,
          op_id: entry.opId,
          created_at: entry.createdAt.toISOString(),
        });
      }

      const supplies: SuppliedProductItem[] = contact.suppliedProducts
        .filter((sp) => sp.storeProduct !== null)
        .map((sp) => ({
          id: sp.storeProduct.id,
          name: sp.storeProduct.nameAr || "—",
        }));

      let balance = 0;
      if (contact.kind === "supplier") {
        balance = Math.max(0, Number(iOweSum - owedToMeSum));
      } else {
        balance = Number(owedToMeSum - iOweSum);
      }

      return {
        person: {
          id: contact.id,
          store_id: contact.storeId,
          kind: contact.kind,
          name: contact.nameAr,
          phone: contact.phone,
          amount_piasters: balance,
          note: latestNote,
          supplies,
          created_at: contact.createdAt.toISOString(),
          updated_at: contact.updatedAt.toISOString(),
        },
        transactions,
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Records a debt or collection/repayment transaction for a contact.
 */
export async function recordDebtTransaction(
  storeId: string,
  contactId: string,
  input: RecordDebtTransactionInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<DebtTransactionItem> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, storeId, deletedAt: null },
      });

      if (!contact) {
        throw new Error("الشخص غير موجود أو تم حذفه");
      }

      // Check idempotency via opId
      const opId = input.opId ?? crypto.randomUUID();
      const existing = await tx.debtEntry.findFirst({
        where: { storeId, opId },
      });

      if (existing) {
        let type: "debt" | "payment" = "debt";
        if (contact.kind === "supplier") {
          type = existing.direction === "owed_to_me" ? "payment" : "debt";
        } else {
          type = existing.direction === "i_owe" ? "payment" : "debt";
        }
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

      // Determine direction:
      // For Customer:
      //   - debt = owed_to_me (customer took credit)
      //   - payment = i_owe (customer paid back / collection)
      // For Supplier / IOwe:
      //   - debt = i_owe (shop owes them more)
      //   - payment = owed_to_me (shop paid supplier / repayment)
      let direction: "owed_to_me" | "i_owe";
      if (contact.kind === "supplier") {
        direction = input.type === "payment" ? "owed_to_me" : "i_owe";
      } else {
        direction = input.type === "payment" ? "i_owe" : "owed_to_me";
      }

      const entry = await tx.debtEntry.create({
        data: {
          storeId,
          contactId: contact.id,
          direction,
          amountPiasters: BigInt(input.amountPiasters),
          noteAr: input.note?.trim() || null,
          opId,
        },
      });

      return {
        id: entry.id,
        direction: entry.direction,
        type: input.type,
        amount_piasters: Number(entry.amountPiasters),
        note: entry.noteAr,
        op_id: entry.opId,
        created_at: entry.createdAt.toISOString(),
      };
    },
    customPrisma ?? defaultPrisma,
  );
}

/**
 * Updates a contact and adjusts balance/supplies if needed.
 */
export async function updatePerson(
  storeId: string,
  contactId: string,
  input: UpdatePersonInput,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<FormattedPerson> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, storeId, deletedAt: null },
        include: {
          debtEntries: true,
          suppliedProducts: {
            include: {
              storeProduct: { select: { id: true, nameAr: true } },
            },
          },
        },
      });

      if (!contact) {
        throw new Error("الشخص أو المورد غير موجود أو لا تملك صلاحية تعديله");
      }

      // Update name and phone if provided
      const updateData: Prisma.ContactUpdateInput = {};
      if (input.name !== undefined) updateData.nameAr = input.name.trim();
      if (input.phone !== undefined)
        updateData.phone = input.phone?.trim() || null;

      if (Object.keys(updateData).length > 0) {
        await tx.contact.update({
          where: { id: contact.id },
          data: updateData,
        });
      }

      // If supplier and supplies provided, sync supplied products
      if (input.supplies !== undefined && contact.kind === "supplier") {
        await tx.supplierProduct.deleteMany({
          where: { supplierId: contact.id },
        });

        if (input.supplies.length > 0) {
          const valid = await tx.storeProduct.findMany({
            where: { storeId, id: { in: input.supplies } },
            select: { id: true, nameAr: true },
          });

          if (valid.length > 0) {
            await tx.supplierProduct.createMany({
              data: valid.map((vp) => ({
                storeId,
                supplierId: contact.id,
                storeProductId: vp.id,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      // If amountPiasters was specified, record adjustment transaction if balance differs
      let currentBalance = 0;
      let owedToMeSum = BigInt(0);
      let iOweSum = BigInt(0);

      for (const entry of contact.debtEntries) {
        if (entry.direction === "owed_to_me")
          owedToMeSum += entry.amountPiasters;
        else iOweSum += entry.amountPiasters;
      }

      if (contact.kind === "supplier") {
        currentBalance = Math.max(0, Number(iOweSum - owedToMeSum));
      } else {
        currentBalance = Number(owedToMeSum - iOweSum);
      }

      let latestNote = input.note ?? null;

      if (
        input.amountPiasters !== undefined &&
        input.amountPiasters !== currentBalance
      ) {
        const delta = input.amountPiasters - currentBalance;
        const absDelta = BigInt(Math.abs(delta));
        let direction: "owed_to_me" | "i_owe";

        if (contact.kind === "supplier") {
          // If delta > 0, store owes more -> i_owe
          // If delta < 0, store owes less -> owed_to_me
          direction = delta > 0 ? "i_owe" : "owed_to_me";
        } else {
          // If delta > 0, customer owes more -> owed_to_me
          // If delta < 0, customer owes less -> i_owe
          direction = delta > 0 ? "owed_to_me" : "i_owe";
        }

        const noteText = input.note?.trim() || "تعديل رصيد";
        latestNote = noteText;

        await tx.debtEntry.create({
          data: {
            storeId,
            contactId: contact.id,
            direction,
            amountPiasters: absDelta,
            noteAr: noteText,
            opId: crypto.randomUUID(),
          },
        });
      }

      // Re-fetch updated record to return
      const updated = await tx.contact.findFirst({
        where: { id: contact.id },
        include: {
          debtEntries: true,
          suppliedProducts: {
            include: {
              storeProduct: { select: { id: true, nameAr: true } },
            },
          },
        },
      });

      if (!updated) {
        throw new Error("حدث خطأ أثناء حفظ البيانات");
      }

      let finalOwedToMe = BigInt(0);
      let finalIOwe = BigInt(0);
      for (const entry of updated.debtEntries) {
        if (entry.direction === "owed_to_me")
          finalOwedToMe += entry.amountPiasters;
        else finalIOwe += entry.amountPiasters;
      }

      let finalAmount = 0;
      if (updated.kind === "supplier") {
        finalAmount = Math.max(0, Number(finalIOwe - finalOwedToMe));
      } else {
        finalAmount = Number(finalOwedToMe - finalIOwe);
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
        kind: updated.kind,
        name: updated.nameAr,
        phone: updated.phone,
        amount_piasters: finalAmount,
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
 * Soft deletes a contact by setting deleted_at = now().
 * Preserves debt entries and transaction history for auditability.
 */
export async function deletePerson(
  storeId: string,
  contactId: string,
  userId?: string | null,
  customPrisma?: PrismaClient,
): Promise<{ success: boolean; id: string }> {
  return await withTenant(
    storeId,
    userId ?? null,
    async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: contactId, storeId, deletedAt: null },
      });

      if (!contact) {
        throw new Error("الشخص أو المورد غير موجود أو تم حذفه بالفعل");
      }

      await tx.contact.update({
        where: { id: contact.id },
        data: { deletedAt: new Date() },
      });

      return { success: true, id: contact.id };
    },
    customPrisma ?? defaultPrisma,
  );
}
