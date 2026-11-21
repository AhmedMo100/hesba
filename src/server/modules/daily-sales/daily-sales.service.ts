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
} satisfies Prisma.DailySalesEntryInclude;

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
  const same =
    v.cashPiasters === input.cashPiasters &&
    v.parts.length === want.size &&
    v.parts.every((p) => want.get(p.machineId) === p.amountPiasters);
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
  const total =
    input.cashPiasters + input.parts.reduce((s, p) => s + p.amountPiasters, 0);
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
            note: input.note?.trim() || null,
            createdBy: userId,
          },
          select: { id: true },
        });
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
      return {
        entries,
        totalPiasters,
        cashPiasters,
        walletPiasters: totalPiasters - cashPiasters,
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
      const cancelled = await tx.dailySalesEntry.update({
        where: { id: entryId },
        data: { cancelledAt: new Date() },
        include,
      });
      return view(cancelled);
    },
    prisma,
  );
}
