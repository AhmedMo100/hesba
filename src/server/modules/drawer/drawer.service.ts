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
import type {
  DrawerCountInput,
  DrawerFlow,
  DrawerView,
} from "@/schemas/drawer";

const ZERO = BigInt(0);
/** The top-up source the machine screen records for money taken from the drawer. */
export const DRAWER_TOPUP_SOURCE = "خزينة المحل (كاش)";

const sum = (v: bigint | null | undefined) => v ?? ZERO;

async function flowsSince(tx: TenantTx, storeId: string, since: Date) {
  const after = { gt: since };
  const [
    cashSales,
    voidedOld,
    refunds,
    collections,
    supplierPayments,
    expenses,
    stockPurchases,
    topups,
  ] = await Promise.all([
    tx.sale.aggregate({
      where: {
        storeId,
        paymentMethod: "cash",
        createdAt: after,
        saleVoid: { is: null },
      },
      _sum: { totalPiasters: true },
      _count: true,
    }),
    // A cash sale made before the count and undone after it: its money left the drawer.
    tx.saleVoid.findMany({
      where: {
        storeId,
        createdAt: after,
        sale: { paymentMethod: "cash", createdAt: { lte: since } },
      },
      select: { sale: { select: { totalPiasters: true } } },
    }),
    tx.saleReturn.aggregate({
      where: { storeId, createdAt: after, sale: { paymentMethod: "cash" } },
      _sum: { refundedPiasters: true },
      _count: true,
    }),
    tx.debtEntry.aggregate({
      where: {
        storeId,
        customerId: { not: null },
        direction: "i_owe",
        entryKind: "transaction",
        paidFrom: "cash",
        createdAt: after,
      },
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.debtEntry.aggregate({
      where: {
        storeId,
        OR: [{ supplierId: { not: null } }, { payableId: { not: null } }],
        direction: "owed_to_me",
        entryKind: "transaction",
        paidFrom: "cash",
        createdAt: after,
      },
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.expense.aggregate({
      where: { storeId, paidFrom: "cash", deletedAt: null, createdAt: after },
      _sum: { amountPiasters: true },
      _count: true,
    }),
    tx.storeStockBatch.aggregate({
      where: {
        storeId,
        paidFrom: "cash",
        costTotalMinor: { not: null },
        createdAt: after,
      },
      _sum: { costTotalMinor: true },
      _count: true,
    }),
    tx.posMachineTopup.aggregate({
      where: {
        storeId,
        source: DRAWER_TOPUP_SOURCE,
        amountPiasters: { gt: ZERO },
        createdAt: after,
      },
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
  const [expenses, payments, batches] = await Promise.all([
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
  ]);
  return {
    count: expenses._count + payments._count + batches._count,
    amountPiasters: Number(
      sum(expenses._sum.amountPiasters) +
        sum(payments._sum.amountPiasters) +
        sum(batches._sum.costTotalMinor),
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
      const existing = await tx.cashDrawerCount.findFirst({
        where: { storeId, opId: input.opId },
        select: { id: true },
      });
      if (!existing) {
        const before = await viewInTx(tx, storeId);
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
