import "server-only";

/**
 * @file expense.service.ts
 * @description Store expenses (rent, transport, salaries, ...) with period filters.
 *
 * @responsibility
 * List expenses for a period with totals per category, create, edit, and delete.
 *
 * @usedBy
 * `src/app/api/expenses/route.ts`, `src/app/api/expenses/[id]/route.ts`.
 *
 * @remarks
 * - Periods (`today`, `yesterday`, `7days`/`week`, `month`, `year`, `custom`, `all`; unknown
 *   values mean today) are computed on the Cairo calendar and compared against UTC timestamps.
 * - Delete is a soft delete (`deletedAt`); deleted expenses are excluded from lists and totals.
 * - Amounts are integer piasters.
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "@/server/platform/error";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
import {
  createExpenseInputSchema,
  updateExpenseInputSchema,
} from "@/schemas/expense";
import { toCairoDateString } from "@/domain/time";
import { changeMachineBalanceInTx } from "@/server/modules/machines";

/** The machine ledger's `source` for an expense paid from it, and for its cancel. */
export const EXPENSE_LEDGER_SOURCE = "مصروف";
export const EXPENSE_CANCEL_LEDGER_SOURCE = "رجوع مصروف اتلغى";

export interface FormattedExpense {
  id: string;
  store_id: string;
  category: string;
  amount_piasters: number;
  note: string | null;
  spent_at: string;
  created_at: string;
  updated_at: string;
  /** 'cash' (the drawer) | 'wallet' | null (not recorded). */
  paid_from: string | null;
  /** The machine / wallet that paid it, when one did. */
  machine: { id: string; name: string } | null;
  /** When it was cancelled; a cancelled expense stays on record and counts nowhere. */
  cancelled_at: string | null;
}

export interface ExpensesListResult {
  expenses: FormattedExpense[];
  totalPiasters: number;
  byCategory: Record<string, number>;
}

export interface GetStoreExpensesFilter {
  period?: string;
  from?: string;
  to?: string;
  category?: string;
  /** Also list the cancelled ones (marked, never in the totals). */
  includeCancelled?: boolean;
}

type ExpenseRow = {
  id: string;
  storeId: string;
  category: string;
  amountPiasters: bigint;
  note: string | null;
  spentAt: Date;
  createdAt: Date;
  updatedAt: Date;
  paidFrom: string | null;
  deletedAt: Date | null;
};

function formatExpense(
  e: ExpenseRow,
  machine: { id: string; name: string } | null,
): FormattedExpense {
  return {
    id: e.id,
    store_id: e.storeId,
    category: e.category,
    amount_piasters: Number(e.amountPiasters),
    note: e.note,
    spent_at: e.spentAt.toISOString(),
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
    paid_from: e.paidFrom,
    machine,
    cancelled_at: e.deletedAt ? e.deletedAt.toISOString() : null,
  };
}

/** The machine each expense was paid from, from the machine ledger (reference = expense id). */
async function machinesFor(
  tx: Prisma.TransactionClient,
  storeId: string,
  expenseIds: string[],
): Promise<Map<string, { id: string; name: string }>> {
  const out = new Map<string, { id: string; name: string }>();
  if (expenseIds.length === 0) return out;
  const rows = await tx.posMachineTopup.findMany({
    where: {
      storeId,
      source: EXPENSE_LEDGER_SOURCE,
      reference: { in: expenseIds },
    },
    select: { reference: true, machine: { select: { id: true, name: true } } },
  });
  for (const r of rows) if (r.reference) out.set(r.reference, r.machine);
  return out;
}

function getStartOfCairoDay(dateStr: string): Date {
  const dateParts = dateStr.split("-").map(Number);
  const cy = dateParts[0] ?? 2026;
  const cm = dateParts[1] ?? 1;
  const cd = dateParts[2] ?? 1;
  const candidateUtc = new Date(Date.UTC(cy, cm - 1, cd, 0, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(candidateUtc);
  const cairoHour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return new Date(candidateUtc.getTime() - cairoHour * 3600000);
}

export function computePeriodDateRange(
  period?: string,
  custom?: { from?: string; to?: string },
): { gte?: Date; lte?: Date } {
  const todayStr = toCairoDateString(new Date());
  const [y, m] = todayStr.split("-").map(Number);

  const todayStart = getStartOfCairoDay(todayStr);
  const todayEnd = new Date(todayStart.getTime() + 24 * 3600000 - 1);

  switch (period) {
    case "today":
      return { gte: todayStart, lte: todayEnd };
    case "yesterday": {
      const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600000);
      const yesterdayEnd = new Date(todayStart.getTime() - 1);
      return { gte: yesterdayStart, lte: yesterdayEnd };
    }
    case "7days":
    case "week": {
      const weekStart = new Date(todayStart.getTime() - 6 * 24 * 3600000);
      return { gte: weekStart, lte: todayEnd };
    }
    case "month": {
      const monthStartStr = `${y}-${String(m).padStart(2, "0")}-01`;
      const monthStart = getStartOfCairoDay(monthStartStr);
      return { gte: monthStart, lte: todayEnd };
    }
    case "year": {
      const yearStartStr = `${y}-01-01`;
      const yearStart = getStartOfCairoDay(yearStartStr);
      return { gte: yearStart, lte: todayEnd };
    }
    case "custom": {
      // A date that is not YYYY-MM-DD is the client's mistake: 400, never a 500 from an
      // Invalid Date and never a silent fallback to another period (QA-19).
      for (const d of [custom?.from, custom?.to]) {
        if (d !== undefined && !isValidDateOnly(d)) {
          throw AppError.badRequest("التاريخ غير صحيح");
        }
      }
      if (custom?.from && custom?.to) {
        let f = custom.from;
        let t = custom.to;
        if (f > t) [f, t] = [t, f];
        const gte = getStartOfCairoDay(f);
        const toStart = getStartOfCairoDay(t);
        const lte = new Date(toStart.getTime() + 24 * 3600000 - 1);
        return { gte, lte };
      }
      return { gte: todayStart, lte: todayEnd };
    }
    case "all":
      return {};
    default:
      return { gte: todayStart, lte: todayEnd };
  }
}

/** True for a real calendar date written as YYYY-MM-DD. */
function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export class ExpenseService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async getStoreExpenses(
    storeId: string,
    userId: string | null,
    filter?: GetStoreExpensesFilter,
  ): Promise<ExpensesListResult> {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const dateRange = computePeriodDateRange(filter?.period, {
          from: filter?.from,
          to: filter?.to,
        });

        const where: Prisma.ExpenseWhereInput = { storeId };
        if (!filter?.includeCancelled) where.deletedAt = null;

        if (dateRange.gte || dateRange.lte) {
          where.spentAt = {};
          if (dateRange.gte) where.spentAt.gte = dateRange.gte;
          if (dateRange.lte) where.spentAt.lte = dateRange.lte;
        }

        if (filter?.category && filter.category.trim() !== "") {
          where.category = filter.category.trim();
        }

        const rows = await tx.expense.findMany({
          where,
          orderBy: { spentAt: "desc" },
        });

        let totalPiasters = 0;
        const byCategory: Record<string, number> = {};
        const machines = await machinesFor(
          tx,
          storeId,
          rows.filter((e) => e.paidFrom === "wallet").map((e) => e.id),
        );

        const formatted: FormattedExpense[] = rows.map((e) => {
          if (!e.deletedAt) {
            const amt = Number(e.amountPiasters);
            totalPiasters += amt;
            byCategory[e.category] = (byCategory[e.category] || 0) + amt;
          }
          return formatExpense(e, machines.get(e.id) ?? null);
        });

        return {
          expenses: formatted,
          totalPiasters,
          byCategory,
        };
      },
      this.prisma,
    );
  }

  async createExpense(
    storeId: string,
    userId: string | null,
    rawInput: unknown,
  ): Promise<FormattedExpense> {
    const validated = createExpenseInputSchema.parse(rawInput);

    let spentAtDate = new Date();
    if (validated.spentAt) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(validated.spentAt)) {
        // Provided as date only, set to noon in Cairo time to avoid day boundaries
        const p = validated.spentAt.split("-").map(Number);
        const y = p[0] ?? 2026;
        const m = p[1] ?? 1;
        const d = p[2] ?? 1;
        spentAtDate = new Date(Date.UTC(y, m - 1, d, 10, 0, 0)); // Cairo is UTC+2, so 10:00 UTC = 12:00 Cairo
      } else {
        spentAtDate = new Date(validated.spentAt);
      }
    }

    // A retry carries the same opId (QA-27): it returns the expense already recorded. The same
    // opId with a different expense is a 409, never a silent second record or a silent merge.
    const replay = async (tx: Prisma.TransactionClient) => {
      if (!validated.opId) return null;
      const existing = await tx.expense.findFirst({
        where: { storeId, opId: validated.opId },
      });
      if (!existing) return null;
      const machine =
        (await machinesFor(tx, storeId, [existing.id])).get(existing.id) ??
        null;
      const same =
        existing.category === validated.category &&
        existing.amountPiasters === BigInt(validated.amountPiasters) &&
        (existing.note ?? null) === (validated.note ?? null) &&
        (machine?.id ?? null) === (validated.paidFromMachineId ?? null);
      if (!same) {
        throw AppError.conflict("العملية دي اتسجلت قبل كده بمصروف تاني");
      }
      return formatExpense(existing, machine);
    };

    try {
      return await withTenant(
        storeId,
        userId,
        async (tx) => {
          const replayed = await replay(tx);
          if (replayed) return replayed;
          const fromMachine = validated.paidFromMachineId ?? null;
          const created = await tx.expense.create({
            data: {
              storeId,
              category: validated.category,
              amountPiasters: BigInt(validated.amountPiasters),
              note: validated.note ?? null,
              spentAt: spentAtDate,
              opId: validated.opId ?? null,
              paidFrom: fromMachine ? "wallet" : (validated.paidFrom ?? null),
            },
          });
          // Paid from a machine / wallet: its balance goes down in this same transaction. A
          // short balance throws, and the expense is never recorded (no partial expense).
          let machine: { id: string; name: string } | null = null;
          if (fromMachine) {
            const r = await changeMachineBalanceInTx(
              tx,
              storeId,
              fromMachine,
              { kind: "delta", amountPiasters: -validated.amountPiasters },
              {
                source: EXPENSE_LEDGER_SOURCE,
                reference: created.id,
                notes: validated.category,
              },
            );
            machine = { id: r.machineId, name: r.machineName };
          }
          return formatExpense(created, machine);
        },
        this.prisma,
      );
    } catch (err) {
      // A concurrent request with the same opId committed first (unique store_id + op_id):
      // this one rolled back; answer with the recorded expense.
      if (
        validated.opId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const replayed = await withTenant(storeId, userId, replay, this.prisma);
        if (replayed) return replayed;
      }
      throw err;
    }
  }

  async updateExpense(
    storeId: string,
    userId: string | null,
    id: string,
    rawInput: unknown,
  ): Promise<FormattedExpense> {
    const validated = updateExpenseInputSchema.parse(rawInput);

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const existing = await tx.expense.findFirst({
          where: { id, storeId, deletedAt: null },
        });

        if (!existing) {
          throw AppError.notFound("المصروف غير موجود");
        }
        const machine =
          (await machinesFor(tx, storeId, [existing.id])).get(existing.id) ??
          null;
        // A machine paid this amount: changing it here would leave the machine's balance wrong.
        if (
          machine &&
          validated.amountPiasters !== undefined &&
          BigInt(validated.amountPiasters) !== existing.amountPiasters
        ) {
          throw AppError.conflict(
            "المصروف ده اتدفع من ماكينة: ألغيه وسجّله من جديد بالمبلغ الصح",
          );
        }

        const data: Prisma.ExpenseUpdateInput = {};
        if (validated.category !== undefined) {
          data.category = validated.category;
        }
        if (validated.amountPiasters !== undefined) {
          data.amountPiasters = BigInt(validated.amountPiasters);
        }
        if (validated.note !== undefined) {
          data.note = validated.note;
        }
        if (validated.spentAt !== undefined) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(validated.spentAt)) {
            const p = validated.spentAt.split("-").map(Number);
            const y = p[0] ?? 2026;
            const m = p[1] ?? 1;
            const d = p[2] ?? 1;
            data.spentAt = new Date(Date.UTC(y, m - 1, d, 10, 0, 0));
          } else {
            data.spentAt = new Date(validated.spentAt);
          }
        }

        const updated = await tx.expense.update({
          where: { id },
          data,
        });

        return formatExpense(updated, machine);
      },
      this.prisma,
    );
  }

  /**
   * Cancels one of today's expenses (V19 «رجّع»). The record stays (marked cancelled, out of
   * every total) and its money goes back where it came from: the drawer stops counting it, and a
   * machine / wallet that paid it gets the amount back through its ledger, in one transaction.
   * An expense of an earlier day is not cancelled here (409). A repeated cancel is the same one.
   */
  async deleteExpense(
    storeId: string,
    userId: string | null,
    id: string,
  ): Promise<{ success: boolean; expense: FormattedExpense }> {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        // Lock the row: two cancels at once refund the machine once.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id FROM expenses
           WHERE id = ${id}::uuid AND store_id = ${storeId}::uuid
             FOR UPDATE`;
        if (locked.length === 0) {
          throw AppError.notFound("المصروف غير موجود");
        }
        const existing = await tx.expense.findFirstOrThrow({
          where: { id, storeId },
        });
        const machine = (await machinesFor(tx, storeId, [id])).get(id) ?? null;
        // A retried cancel (the first response was lost) is the same cancel (QA-27).
        if (existing.deletedAt !== null) {
          return { success: true, expense: formatExpense(existing, machine) };
        }
        const today = toCairoDateString(new Date());
        if (toCairoDateString(existing.spentAt) !== today) {
          throw AppError.conflict("ينفع تلغي مصروفات النهارده بس");
        }

        // What the machine ledger took for this expense, net of anything already given back.
        const ledger = await tx.posMachineTopup.findMany({
          where: {
            storeId,
            reference: id,
            source: {
              in: [EXPENSE_LEDGER_SOURCE, EXPENSE_CANCEL_LEDGER_SOURCE],
            },
          },
          select: { machineId: true, amountPiasters: true },
        });
        const net = new Map<string, bigint>();
        for (const l of ledger) {
          net.set(
            l.machineId,
            (net.get(l.machineId) ?? BigInt(0)) + l.amountPiasters,
          );
        }
        for (const [machineId, amount] of net) {
          if (amount < BigInt(0)) {
            await changeMachineBalanceInTx(
              tx,
              storeId,
              machineId,
              { kind: "delta", amountPiasters: Number(-amount) },
              {
                source: EXPENSE_CANCEL_LEDGER_SOURCE,
                reference: id,
                notes: existing.category,
              },
            );
          }
        }

        const cancelled = await tx.expense.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        return { success: true, expense: formatExpense(cancelled, machine) };
      },
      this.prisma,
    );
  }
}
