import "server-only";
import { type Prisma, type PrismaClient } from "@prisma/client";
import { withTenant } from "@/server/infra/db/tenant";
import { prisma as defaultPrisma } from "@/server/infra/db/client";
import {
  createExpenseInputSchema,
  updateExpenseInputSchema,
} from "@/schemas/expense";
import { toCairoDateString } from "@/domain/time";

export interface FormattedExpense {
  id: string;
  store_id: string;
  category: string;
  amount_piasters: number;
  note: string | null;
  spent_at: string;
  created_at: string;
  updated_at: string;
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

        const where: Prisma.ExpenseWhereInput = {
          storeId,
          deletedAt: null,
        };

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

        const formatted: FormattedExpense[] = rows.map((e) => {
          const amt = Number(e.amountPiasters);
          totalPiasters += amt;
          byCategory[e.category] = (byCategory[e.category] || 0) + amt;

          return {
            id: e.id,
            store_id: e.storeId,
            category: e.category,
            amount_piasters: amt,
            note: e.note,
            spent_at: e.spentAt.toISOString(),
            created_at: e.createdAt.toISOString(),
            updated_at: e.updatedAt.toISOString(),
          };
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

    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const created = await tx.expense.create({
          data: {
            storeId,
            category: validated.category,
            amountPiasters: BigInt(validated.amountPiasters),
            note: validated.note ?? null,
            spentAt: spentAtDate,
          },
        });

        return {
          id: created.id,
          store_id: created.storeId,
          category: created.category,
          amount_piasters: Number(created.amountPiasters),
          note: created.note,
          spent_at: created.spentAt.toISOString(),
          created_at: created.createdAt.toISOString(),
          updated_at: created.updatedAt.toISOString(),
        };
      },
      this.prisma,
    );
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
          throw new Error("المصروف غير موجود أو لا تملك صلاحية تعديله");
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

        return {
          id: updated.id,
          store_id: updated.storeId,
          category: updated.category,
          amount_piasters: Number(updated.amountPiasters),
          note: updated.note,
          spent_at: updated.spentAt.toISOString(),
          created_at: updated.createdAt.toISOString(),
          updated_at: updated.updatedAt.toISOString(),
        };
      },
      this.prisma,
    );
  }

  async deleteExpense(
    storeId: string,
    userId: string | null,
    id: string,
  ): Promise<{ success: boolean }> {
    return withTenant(
      storeId,
      userId,
      async (tx) => {
        const existing = await tx.expense.findFirst({
          where: { id, storeId, deletedAt: null },
        });

        if (!existing) {
          throw new Error("المصروف غير موجود أو تم حذفه بالفعل");
        }

        await tx.expense.update({
          where: { id },
          data: { deletedAt: new Date() },
        });

        return { success: true };
      },
      this.prisma,
    );
  }
}
