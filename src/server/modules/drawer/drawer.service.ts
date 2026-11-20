import "server-only";

/**
 * @file drawer.service.ts
 * @description The cash drawer (ADR-0031): the last count the owner made, plus the cash that
 * moved through the drawer after it. Only movements recorded as cash count; movements whose
 * source was not recorded are reported apart and never guessed. Before the first count there
 * is no expected amount.
 */
import { prisma } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import type {
  DrawerCountInput,
  DrawerFlow,
  DrawerMovement,
  DrawerView,
} from "@/schemas/drawer";

const ZERO = BigInt(0);
/** The top-up source the machine screen records for money taken from the drawer. */
export const DRAWER_TOPUP_SOURCE = "خزينة المحل (كاش)";

const sum = (v: bigint | null | undefined) => v ?? ZERO;

/** Where each kind of cash movement is found (shared by the totals and the list). */
function cashWhere(storeId: string, since: Date) {
  const after = { gt: since };
  return {
    cashSales: {
      storeId,
      paymentMethod: "cash" as const,
      createdAt: after,
      saleVoid: { is: null },
    },
    voidedOld: {
      storeId,
      createdAt: after,
      sale: { paymentMethod: "cash" as const, createdAt: { lte: since } },
    },
    refunds: {
      storeId,
      createdAt: after,
      sale: { paymentMethod: "cash" as const },
      refundedPiasters: { gt: ZERO },
    },
    collections: {
      storeId,
      customerId: { not: null },
      direction: "i_owe" as const,
      entryKind: "transaction",
      paidFrom: "cash",
      createdAt: after,
    },
    supplierPayments: {
      storeId,
      OR: [{ supplierId: { not: null } }, { payableId: { not: null } }],
      direction: "owed_to_me" as const,
      entryKind: "transaction",
      paidFrom: "cash",
      createdAt: after,
    },
    expenses: { storeId, paidFrom: "cash", deletedAt: null, createdAt: after },
    stockPurchases: {
      storeId,
      paidFrom: "cash",
      costTotalMinor: { not: null },
      createdAt: after,
    },
    topups: {
      storeId,
      source: DRAWER_TOPUP_SOURCE,
      amountPiasters: { gt: ZERO },
      createdAt: after,
    },
    expenseCancels: {
      storeId,
      paidFrom: "cash",
      createdAt: { lte: since },
      deletedAt: after,
    },
  };
}

/** The latest cash movements since `since`, one line each (V19 «الحركات الكاش من آخر قفل»). */
async function movementsSince(
  tx: TenantTx,
  storeId: string,
  since: Date,
  limit = 40,
): Promise<DrawerMovement[]> {
  const w = cashWhere(storeId, since);
  const take = limit;
  const desc = { createdAt: "desc" as const };
  const [
    sales,
    voids,
    refunds,
    collections,
    payments,
    expenses,
    batches,
    topups,
    cancels,
  ] = await Promise.all([
    tx.sale.findMany({
      where: w.cashSales,
      orderBy: desc,
      take,
      select: {
        id: true,
        totalPiasters: true,
        createdAt: true,
        saleLines: {
          take: 1,
          select: {
            storeProduct: { select: { nameAr: true } },
            storeVariant: {
              select: { storeProduct: { select: { nameAr: true } } },
            },
          },
        },
        _count: { select: { saleLines: true } },
      },
    }),
    tx.saleVoid.findMany({
      where: w.voidedOld,
      orderBy: desc,
      take,
      select: {
        id: true,
        createdAt: true,
        sale: { select: { totalPiasters: true } },
      },
    }),
    tx.saleReturn.findMany({
      where: w.refunds,
      orderBy: desc,
      take,
      select: { id: true, createdAt: true, refundedPiasters: true },
    }),
    tx.debtEntry.findMany({
      where: w.collections,
      orderBy: desc,
      take,
      select: {
        id: true,
        createdAt: true,
        amountPiasters: true,
        customer: { select: { nameAr: true } },
      },
    }),
    tx.debtEntry.findMany({
      where: w.supplierPayments,
      orderBy: desc,
      take,
      select: {
        id: true,
        createdAt: true,
        amountPiasters: true,
        supplier: { select: { nameAr: true } },
        payable: { select: { nameAr: true } },
      },
    }),
    tx.expense.findMany({
      where: w.expenses,
      orderBy: desc,
      take,
      select: {
        id: true,
        createdAt: true,
        amountPiasters: true,
        category: true,
      },
    }),
    tx.storeStockBatch.findMany({
      where: w.stockPurchases,
      orderBy: desc,
      take,
      select: {
        id: true,
        createdAt: true,
        costTotalMinor: true,
        storeVariant: {
          select: { storeProduct: { select: { nameAr: true } } },
        },
      },
    }),
    tx.posMachineTopup.findMany({
      where: w.topups,
      orderBy: desc,
      take,
      select: {
        id: true,
        createdAt: true,
        amountPiasters: true,
        machine: { select: { name: true } },
      },
    }),
    tx.expense.findMany({
      where: w.expenseCancels,
      orderBy: { deletedAt: "desc" },
      take,
      select: {
        id: true,
        deletedAt: true,
        amountPiasters: true,
        category: true,
      },
    }),
  ]);
  const n = (v: bigint | null | undefined) => Number(v ?? ZERO);
  const all: DrawerMovement[] = [
    ...sales.map((x) => {
      const line = x.saleLines[0];
      const first =
        line?.storeProduct?.nameAr ?? line?.storeVariant?.storeProduct?.nameAr;
      const more = x._count.saleLines > 1 ? ` +${x._count.saleLines - 1}` : "";
      return {
        id: `sale:${x.id}`,
        kind: "cashSales" as const,
        direction: "in" as const,
        title: first ? `بيع كاش: ${first}${more}` : "بيع كاش",
        amountPiasters: n(x.totalPiasters),
        at: x.createdAt.toISOString(),
      };
    }),
    ...collections.map((x) => ({
      id: `col:${x.id}`,
      kind: "collections" as const,
      direction: "in" as const,
      title: `تحصيل من ${x.customer?.nameAr ?? "زبون"}`,
      amountPiasters: n(x.amountPiasters),
      at: x.createdAt.toISOString(),
    })),
    ...cancels.map((x) => ({
      id: `cancel:${x.id}`,
      kind: "expenseCancels" as const,
      direction: "in" as const,
      title: `مصروف اتلغى: ${x.category}`,
      amountPiasters: n(x.amountPiasters),
      at: (x.deletedAt ?? new Date()).toISOString(),
    })),
    ...refunds.map((x) => ({
      id: `ret:${x.id}`,
      kind: "refunds" as const,
      direction: "out" as const,
      title: "مرتجع اترجع كاش",
      amountPiasters: n(x.refundedPiasters),
      at: x.createdAt.toISOString(),
    })),
    ...voids.map((x) => ({
      id: `void:${x.id}`,
      kind: "voids" as const,
      direction: "out" as const,
      title: "بيعة كاش اتلغت",
      amountPiasters: n(x.sale.totalPiasters),
      at: x.createdAt.toISOString(),
    })),
    ...expenses.map((x) => ({
      id: `exp:${x.id}`,
      kind: "expenses" as const,
      direction: "out" as const,
      title: `مصروف: ${x.category}`,
      amountPiasters: n(x.amountPiasters),
      at: x.createdAt.toISOString(),
    })),
    ...payments.map((x) => ({
      id: `pay:${x.id}`,
      kind: "supplierPayments" as const,
      direction: "out" as const,
      title: `دفعت لـ ${x.supplier?.nameAr ?? x.payable?.nameAr ?? "مورد"}`,
      amountPiasters: n(x.amountPiasters),
      at: x.createdAt.toISOString(),
    })),
    ...batches.map((x) => ({
      id: `batch:${x.id}`,
      kind: "stockPurchases" as const,
      direction: "out" as const,
      title: `بضاعة: ${x.storeVariant?.storeProduct?.nameAr ?? "منتج"}`,
      amountPiasters: n(x.costTotalMinor),
      at: x.createdAt.toISOString(),
    })),
    ...topups.map((x) => ({
      id: `top:${x.id}`,
      kind: "machineTopups" as const,
      direction: "out" as const,
      title: `رصيد لـ ${x.machine.name}`,
      amountPiasters: n(x.amountPiasters),
      at: x.createdAt.toISOString(),
    })),
  ];
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

async function flowsSince(tx: TenantTx, storeId: string, since: Date) {
  const w = cashWhere(storeId, since);
  const [
    cashSales,
    voidedOld,
    refunds,
    collections,
    supplierPayments,
    expenses,
    stockPurchases,
    topups,
    expenseCancels,
  ] = await Promise.all([
    tx.sale.aggregate({
      where: w.cashSales,
      _sum: { totalPiasters: true },
      _count: true,
    }),
    // A cash sale made before the count and undone after it: its money left the drawer.
    tx.saleVoid.findMany({
      where: w.voidedOld,
      select: { sale: { select: { totalPiasters: true } } },
    }),
    tx.saleReturn.aggregate({
      where: w.refunds,
      _sum: { refundedPiasters: true },
      _count: true,
    }),
    tx.debtEntry.aggregate({
      where: w.collections,
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.debtEntry.aggregate({
      where: w.supplierPayments,
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.expense.aggregate({
      where: w.expenses,
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.storeStockBatch.aggregate({
      where: w.stockPurchases,
      _sum: { costTotalMinor: true },
      _count: true,
    }),
    tx.posMachineTopup.aggregate({
      where: w.topups,
      _sum: { amountPiasters: true },
      _count: true,
    }),
    // A cash expense made before the count and cancelled after it: its money came back.
    tx.expense.aggregate({
      where: w.expenseCancels,
      _sum: { amountPiasters: true },
      _count: true,
    }),
  ]);

  const voidsTotal = voidedOld.reduce((n, v) => n + v.sale.totalPiasters, ZERO);
  const flows: DrawerFlow[] = [
    {
      key: "cashSales",
      direction: "in",
      count: cashSales._count,
      amountPiasters: Number(sum(cashSales._sum.totalPiasters)),
    },
    {
      key: "collections",
      direction: "in",
      count: collections._count,
      amountPiasters: Number(sum(collections._sum.amountPiasters)),
    },
    {
      key: "expenseCancels",
      direction: "in",
      count: expenseCancels._count,
      amountPiasters: Number(sum(expenseCancels._sum.amountPiasters)),
    },
    {
      key: "refunds",
      direction: "out",
      count: refunds._count,
      amountPiasters: Number(sum(refunds._sum.refundedPiasters)),
    },
    {
      key: "voids",
      direction: "out",
      count: voidedOld.length,
      amountPiasters: Number(voidsTotal),
    },
    {
      key: "expenses",
      direction: "out",
      count: expenses._count,
      amountPiasters: Number(sum(expenses._sum.amountPiasters)),
    },
    {
      key: "supplierPayments",
      direction: "out",
      count: supplierPayments._count,
      amountPiasters: Number(sum(supplierPayments._sum.amountPiasters)),
    },
    {
      key: "stockPurchases",
      direction: "out",
      count: stockPurchases._count,
      amountPiasters: Number(sum(stockPurchases._sum.costTotalMinor)),
    },
    {
      key: "machineTopups",
      direction: "out",
      count: topups._count,
      amountPiasters: Number(sum(topups._sum.amountPiasters)),
    },
  ];
  return flows;
}

/** Movements after `since` that may have used the drawer but did not record it. */
async function unknownSince(tx: TenantTx, storeId: string, since: Date) {
  const after = { gt: since };
  const [expenses, payments, batches, creditRefunds] = await Promise.all([
    tx.expense.aggregate({
      where: { storeId, paidFrom: null, deletedAt: null, createdAt: after },
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.debtEntry.aggregate({
      where: {
        storeId,
        paidFrom: null,
        entryKind: "transaction",
        createdAt: after,
        OR: [
          { customerId: { not: null }, direction: "i_owe" },
          { supplierId: { not: null }, direction: "owed_to_me" },
          { payableId: { not: null }, direction: "owed_to_me" },
        ],
      },
      _sum: { amountPiasters: true },
      _count: true,
    }),
    // Stock bought outside a supplier invoice with a known cost but no recorded payer.
    tx.storeStockBatch.aggregate({
      where: {
        storeId,
        paidFrom: null,
        supplierId: null,
        costTotalMinor: { gt: ZERO },
        createdAt: after,
        purchaseLines: { none: {} },
      },
      _sum: { costTotalMinor: true },
      _count: true,
    }),
    // A credit invoice's return beyond what was still owed is paid back to the customer, but
    // the return does not record from where: reported, never guessed.
    tx.saleReturn.aggregate({
      where: {
        storeId,
        createdAt: after,
        sale: { paymentMethod: "debt" },
        refundedPiasters: { gt: ZERO },
      },
      _sum: { refundedPiasters: true },
      _count: true,
    }),
  ]);
  return {
    count:
      expenses._count + payments._count + batches._count + creditRefunds._count,
    amountPiasters: Number(
      sum(expenses._sum.amountPiasters) +
        sum(payments._sum.amountPiasters) +
        sum(batches._sum.costTotalMinor) +
        sum(creditRefunds._sum.refundedPiasters),
    ),
  };
}

async function viewInTx(tx: TenantTx, storeId: string): Promise<DrawerView> {
  const counts = await tx.cashDrawerCount.findMany({
    where: { storeId },
    orderBy: { countedAt: "desc" },
    take: 5,
  });
  const recentCounts = counts.map((c) => ({
    countedPiasters: Number(c.countedPiasters),
    expectedPiasters:
      c.expectedPiasters === null ? null : Number(c.expectedPiasters),
    // The server's difference at that close: counted − expected (null for the first count).
    differencePiasters:
      c.expectedPiasters === null
        ? null
        : Number(c.countedPiasters - c.expectedPiasters),
    countedAt: c.countedAt.toISOString(),
  }));
  const last = counts[0];
  if (!last) {
    return {
      lastCount: null,
      expectedPiasters: null,
      inPiasters: 0,
      outPiasters: 0,
      flows: [],
      movements: [],
      unknown: { count: 0, amountPiasters: 0 },
      recentCounts,
    };
  }
  const flows = await flowsSince(tx, storeId, last.countedAt);
  const inPiasters = flows
    .filter((f) => f.direction === "in")
    .reduce((n, f) => n + f.amountPiasters, 0);
  const outPiasters = flows
    .filter((f) => f.direction === "out")
    .reduce((n, f) => n + f.amountPiasters, 0);
  return {
    lastCount: recentCounts[0]!,
    expectedPiasters: Number(last.countedPiasters) + inPiasters - outPiasters,
    inPiasters,
    outPiasters,
    flows,
    movements: await movementsSince(tx, storeId, last.countedAt),
    unknown: await unknownSince(tx, storeId, last.countedAt),
    recentCounts,
  };
}

export async function getDrawer(
  storeId: string,
  userId: string | null,
  db = prisma,
): Promise<DrawerView> {
  return withTenant(storeId, userId, (tx) => viewInTx(tx, storeId), db);
}

/**
 * The owner counted the drawer: recorded with what the screen expected at that moment, and it
 * becomes the base of the next expected amount. Idempotent by `opId`.
 */
export async function recordDrawerCount(
  storeId: string,
  userId: string | null,
  input: DrawerCountInput,
  db = prisma,
): Promise<DrawerView> {
  return withTenant(
    storeId,
    userId,
    async (tx) => {
      // One close at a time per shop: two at once would both start from the same last count.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`drawer:${storeId}`}, 31))::text`;
      const existing = await tx.cashDrawerCount.findFirst({
        where: { storeId, opId: input.opId },
        select: { id: true },
      });
      if (!existing) {
        const before = await viewInTx(tx, storeId);
        // The same close twice (another tab, a refresh): same amount, a minute apart, nothing
        // moved in between — refused instead of recorded twice.
        const last = before.lastCount;
        if (
          last &&
          last.countedPiasters === input.countedPiasters &&
          before.inPiasters === 0 &&
          before.outPiasters === 0 &&
          before.unknown.count === 0 &&
          Date.now() - new Date(last.countedAt).getTime() < 60_000
        ) {
          throw AppError.conflict("الدرج اتقفل لسه بنفس المبلغ");
        }
        await tx.cashDrawerCount.create({
          data: {
            storeId,
            opId: input.opId,
            countedPiasters: BigInt(input.countedPiasters),
            expectedPiasters:
              before.expectedPiasters === null
                ? null
                : BigInt(before.expectedPiasters),
            note: input.note?.trim() || null,
            countedBy: userId,
          },
        });
      }
      return viewInTx(tx, storeId);
    },
    db,
  );
}
