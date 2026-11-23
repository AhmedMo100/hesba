import "server-only";

/**
 * @file daily-sales.service.ts
 * @description إدارة المحل's daily sales total (ADR-0033). The owner records the day's sales as one
 * amount split by payment: the cash part counts in the drawer, each machine / wallet part raises
 * that machine's balance — the entry and the balances in one transaction. Nothing here claims to
 * know which products were sold: no stock moves and no cost is guessed (a stock difference is a
 * stocktake difference, recorded as such).
 *
 * Idempotent by `opId`. A cancel (today's entries only) keeps the entry, takes the money back
 * out of the machines that received it, and the drawer stops counting its cash.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { changeMachineBalanceInTx } from "@/server/modules/machines";
import { lockLedgerOwnerInTx } from "@/server/modules/people";
import {
  lockStockLevelInTx,
  takeStockInTx,
  writeLevelInTx,
} from "@/server/modules/inventory";
import { unitCostFromTotal } from "@/domain/stock/batch-cost";
import { toCairoDateString } from "@/domain/time";
import type {
  DailySalesEntryView,
  DailySalesInput,
} from "@/schemas/daily-sales";

export const DAILY_SALES_LEDGER_SOURCE = "مبيعات اليوم";
export const DAILY_SALES_CANCEL_SOURCE = "مبيعات يوم اتلغت";

const include = {
  parts: {
    select: {
      machineId: true,
      amountPiasters: true,
      machine: { select: { name: true } },
    },
  },
  // The customer debts its credit part created (not their later reversals).
  debts: {
    where: { entryKind: "transaction" },
    select: {
      customerId: true,
      amountPiasters: true,
      customer: { select: { nameAr: true } },
    },
  },
  items: {
    select: {
      storeVariantId: true,
      quantityBase: true,
      costMinor: true,
      storeVariant: {
        select: {
          flavor: true,
          storeProduct: {
            select: {
              nameAr: true,
              globalProduct: { select: { nameAr: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DailySalesEntryInclude;

/** The batch code of stock put back when a daily total with quantities is cancelled. */
export const DAILY_SALES_RESTORE_BATCH_PREFIX = "DSR-";

type Row = Prisma.DailySalesEntryGetPayload<{ include: typeof include }>;

function view(e: Row): DailySalesEntryView {
  return {
    id: e.id,
    businessDay: e.businessDay.toISOString().slice(0, 10),
    totalPiasters: Number(e.totalPiasters),
    cashPiasters: Number(e.cashPiasters),
    parts: e.parts.map((p) => ({
      machineId: p.machineId,
      machineName: p.machine.name,
      amountPiasters: Number(p.amountPiasters),
    })),
    creditPiasters: Number(e.creditPiasters),
    credits: e.debts
      .filter((d) => d.customerId !== null)
      .map((d) => ({
        customerId: d.customerId!,
        customerName: d.customer?.nameAr ?? "زبون",
        amountPiasters: Number(d.amountPiasters),
      })),
    items: e.items.map((i) => {
      const p = i.storeVariant.storeProduct;
      return {
        variantId: i.storeVariantId,
        productName:
          (p?.nameAr || p?.globalProduct?.nameAr || "صنف") +
          (i.storeVariant.flavor ? ` — ${i.storeVariant.flavor}` : ""),
        quantityBase: Number(i.quantityBase),
        costPiasters: i.costMinor === null ? null : Number(i.costMinor),
      };
    }),
    note: e.note,
    createdAt: e.createdAt.toISOString(),
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
  };
}

const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

async function replayInTx(
  tx: TenantTx,
  storeId: string,
  input: DailySalesInput,
): Promise<DailySalesEntryView | null> {
  const existing = await tx.dailySalesEntry.findFirst({
    where: { storeId, opId: input.opId },
    include,
  });
  if (!existing) return null;
  const v = view(existing);
  const want = new Map(input.parts.map((p) => [p.machineId, p.amountPiasters]));
  const wantCredit = new Map(
    input.credits.map((c) => [c.customerId, c.amountPiasters]),
  );
  const wantItems = new Map(
    input.items.map((i) => [i.variantId, i.quantityBase]),
  );
  const same =
    v.cashPiasters === input.cashPiasters &&
    v.parts.length === want.size &&
    v.parts.every((p) => want.get(p.machineId) === p.amountPiasters) &&
    v.credits.length === wantCredit.size &&
    v.credits.every((c) => wantCredit.get(c.customerId) === c.amountPiasters) &&
    v.items.length === wantItems.size &&
    v.items.every((i) => wantItems.get(i.variantId) === i.quantityBase);
  if (!same) {
    throw AppError.conflict("رقم العملية ده اتسجل قبل كده بمبلغ مختلف");
  }
  return v;
}

export async function recordDailySales(
  storeId: string,
  userId: string,
  input: DailySalesInput,
): Promise<{ entry: DailySalesEntryView; duplicate: boolean }> {
  const today = toCairoDateString(new Date());
  const day = input.businessDay ?? today;
  if (day > today) throw AppError.badRequest("اليوم ده لسه مجاش");
  const credit = input.credits.reduce((s, c) => s + c.amountPiasters, 0);
  const total =
    input.cashPiasters +
    input.parts.reduce((s, p) => s + p.amountPiasters, 0) +
    credit;
  try {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const replayed = await replayInTx(tx, storeId, input);
        if (replayed) return { entry: replayed, duplicate: true };
        const created = await tx.dailySalesEntry.create({
          data: {
            storeId,
            opId: input.opId,
            businessDay: dayDate(day),
            totalPiasters: BigInt(total),
            cashPiasters: BigInt(input.cashPiasters),
            creditPiasters: BigInt(credit),
            note: input.note?.trim() || null,
            createdBy: userId,
          },
          select: { id: true },
        });
        const now = new Date();
        // Credit: one debt per customer («ليك»), linked to this total, in the same transaction.
        for (const c of input.credits) {
          const owner = {
            table: "customers" as const,
            customerId: c.customerId,
          };
          if (!(await lockLedgerOwnerInTx(tx, storeId, owner))) {
            throw AppError.notFound("الزبون ده مش موجود أو اتحذف");
          }
          await tx.debtEntry.create({
            data: {
              storeId,
              customerId: c.customerId,
              direction: "owed_to_me",
              amountPiasters: BigInt(c.amountPiasters),
              noteAr: `آجل من مبيعات يوم ${day}`,
              opId: crypto.randomUUID(),
              entryKind: "transaction",
              dailySalesEntryId: created.id,
              createdAt: now,
            },
          });
        }
        // Quantities: stock out (FEFO, with its cost); no money — it is already in the total.
        for (const item of input.items) {
          const variant = await tx.storeVariant.findFirst({
            where: { storeId, id: item.variantId },
            select: { storeProductId: true },
          });
          if (!variant) throw AppError.notFound("الصنف ده مش موجود");
          const available = await lockStockLevelInTx(
            tx,
            storeId,
            item.variantId,
          );
          if (BigInt(item.quantityBase) > available) {
            throw new AppError(
              "CONFLICT",
              `الكمية أكبر من المخزون المتسجل (${Number(available < BigInt(0) ? BigInt(0) : available)}). لو المخزون مش مظبوط اعمل جرد الأول.`,
              409,
              { variantId: item.variantId },
            );
          }
          const taken = await takeStockInTx(tx, storeId, {
            storeVariantId: item.variantId,
            storeProductId: variant.storeProductId,
            quantityBase: BigInt(item.quantityBase),
            type: "daily_sale",
            now,
          });
          await tx.dailySalesEntryItem.create({
            data: {
              storeId,
              entryId: created.id,
              storeVariantId: item.variantId,
              quantityBase: BigInt(item.quantityBase),
              costMinor: taken.costPiasters,
            },
          });
        }
        for (const part of input.parts) {
          // The machine must be this shop's (locked, checked by changeMachineBalanceInTx).
          await changeMachineBalanceInTx(
            tx,
            storeId,
            part.machineId,
            { kind: "delta", amountPiasters: part.amountPiasters },
            { source: DAILY_SALES_LEDGER_SOURCE, reference: created.id },
          );
          await tx.dailySalesEntryPart.create({
            data: {
              storeId,
              entryId: created.id,
              machineId: part.machineId,
              amountPiasters: BigInt(part.amountPiasters),
            },
          });
        }
        const row = await tx.dailySalesEntry.findUniqueOrThrow({
          where: { id: created.id },
          include,
        });
        return { entry: view(row), duplicate: false };
      },
      prisma,
    );
  } catch (err) {
    // The same opId committed by a concurrent request: answer with that entry.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const replayed = await withTenant(
        storeId,
        userId,
        (tx) => replayInTx(tx, storeId, input),
        prisma,
      );
      if (replayed) return { entry: replayed, duplicate: true };
    }
    throw err;
  }
}

export async function listDailySales(
  storeId: string,
  userId: string,
  range: { from: string; to: string },
): Promise<{
  entries: DailySalesEntryView[];
  totalPiasters: number;
  cashPiasters: number;
  walletPiasters: number;
  creditPiasters: number;
}> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const rows = await tx.dailySalesEntry.findMany({
        where: {
          storeId,
          businessDay: { gte: dayDate(range.from), lte: dayDate(range.to) },
        },
        include,
        orderBy: [{ businessDay: "desc" }, { createdAt: "desc" }],
      });
      const entries = rows.map(view);
      const live = entries.filter((e) => !e.cancelledAt);
      const totalPiasters = live.reduce((s, e) => s + e.totalPiasters, 0);
      const cashPiasters = live.reduce((s, e) => s + e.cashPiasters, 0);
      const creditPiasters = live.reduce((s, e) => s + e.creditPiasters, 0);
      return {
        entries,
        totalPiasters,
        cashPiasters,
        walletPiasters: totalPiasters - cashPiasters - creditPiasters,
        creditPiasters,
      };
    },
    prisma,
  );
}

/** Cancels one of today's entries (recorded today, Cairo): kept on record, money given back. */
export async function cancelDailySales(
  storeId: string,
  userId: string,
  entryId: string,
): Promise<DailySalesEntryView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM daily_sales_entries
         WHERE id = ${entryId}::uuid AND store_id = ${storeId}::uuid
           FOR UPDATE`;
      if (locked.length === 0) throw AppError.notFound("التسجيل ده مش موجود");
      const row = await tx.dailySalesEntry.findUniqueOrThrow({
        where: { id: entryId },
        include,
      });
      if (row.cancelledAt) return view(row);
      if (toCairoDateString(row.createdAt) !== toCairoDateString(new Date())) {
        throw AppError.conflict("ينفع تلغي تسجيل النهارده بس");
      }
      for (const p of row.parts) {
        // The wallet gives back what it received; no overdraft (a 400 rolls everything back).
        await changeMachineBalanceInTx(
          tx,
          storeId,
          p.machineId,
          { kind: "delta", amountPiasters: -Number(p.amountPiasters) },
          { source: DAILY_SALES_CANCEL_SOURCE, reference: row.id },
        );
      }
      const now = new Date();
      // The credit part: each customer's debt is taken back by a reversal (never a payment).
      const debts = await tx.debtEntry.findMany({
        where: { storeId, dailySalesEntryId: row.id, entryKind: "transaction" },
      });
      for (const d of debts) {
        if (!d.customerId) continue;
        await lockLedgerOwnerInTx(tx, storeId, {
          table: "customers",
          customerId: d.customerId,
        });
        await tx.debtEntry.create({
          data: {
            storeId,
            customerId: d.customerId,
            direction: "i_owe",
            amountPiasters: d.amountPiasters,
            noteAr: "إلغاء آجل من مبيعات يوم",
            opId: crypto.randomUUID(),
            entryKind: "reversal",
            settlesEntryId: d.id,
            dailySalesEntryId: row.id,
            createdAt: now,
          },
        });
      }
      // The quantities go back to stock at the cost they left with.
      for (const item of row.items) {
        const variant = await tx.storeVariant.findFirst({
          where: { storeId, id: item.storeVariantId },
          select: {
            storeProductId: true,
            storeProduct: { select: { unit: true } },
          },
        });
        const current = await lockStockLevelInTx(
          tx,
          storeId,
          item.storeVariantId,
        );
        const unitCost =
          item.costMinor === null
            ? null
            : unitCostFromTotal(
                item.costMinor,
                item.quantityBase,
                variant?.storeProduct?.unit ?? null,
              );
        const batch = await tx.storeStockBatch.create({
          data: {
            storeId,
            storeVariantId: item.storeVariantId,
            storeProductId: variant?.storeProductId ?? null,
            batchCode: `${DAILY_SALES_RESTORE_BATCH_PREFIX}${now.getTime().toString(36).toUpperCase()}`,
            receivedQuantityBase: item.quantityBase,
            remainingQuantityBase: item.quantityBase,
            costPriceMinor: unitCost,
            costTotalMinor: item.costMinor,
            receivedAt: now,
            paid: true,
          },
        });
        const after = current + item.quantityBase;
        await writeLevelInTx(tx, storeId, item.storeVariantId, after, now);
        await tx.stockMovement.create({
          data: {
            storeId,
            storeVariantId: item.storeVariantId,
            storeProductId: variant?.storeProductId ?? null,
            batchId: batch.id,
            type: "daily_sale",
            quantityBase: item.quantityBase,
            costPriceMinor: unitCost,
            balanceAfterBase: after,
            negative: after < BigInt(0),
            createdAt: now,
          },
        });
      }
      const cancelled = await tx.dailySalesEntry.update({
        where: { id: entryId },
        data: { cancelledAt: now },
        include,
      });
      return view(cancelled);
    },
    prisma,
  );
}
