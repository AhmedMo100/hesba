import "server-only";

/**
 * @file service-transactions.service.ts
 * @description Services the shop performs for customers (wallet deposits / withdrawals,
 * Fawry / Aman, recharge, bills, cards) — in BOTH operating modes — with the shop's commission.
 *
 * Accounting (src/domain/services-catalog.ts): the commission is the only income; the provider
 * float (a machine / wallet) and the customer's side (drawer or another wallet) move so that
 * (money in) − (money out) = commission, checked again by a database CHECK.
 *
 * - ONE commission rule per service (ADR-0035): the service is one of the shop's service
 *   products — the same one the cashier sells — and its rule is the one saved for it in
 *   `salesConfig.serviceCommissions` (slabs / fixed / percent). The commission is computed on the
 *   server from that rule (or typed by the owner) and stored on the transaction: later rule
 *   changes never rewrite history.
 * - Atomic and idempotent by `opId`; the float never goes negative (a send larger than the float
 *   is a 400 and nothing is recorded).
 * - Hesba has no provider API: the owner records an operation AFTER it went through on the
 *   provider's app / machine. Cancelling reverses Hesba's books only — it never claims the
 *   provider reversed anything.
 */

import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { changeMachineBalanceInTx } from "@/server/modules/machines";
import { getSalesViewConfig } from "@/server/modules/sales";
import {
  SERVICE_BY_KEY,
  SERVICE_CATEGORY_LABELS,
  serviceMoney,
  type CommissionMode,
  type ServiceCategory,
} from "@/domain/services-catalog";
import {
  describeCommission,
  serviceRuleOf,
  slabFor,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import {
  SERVICE_CATEGORIES as SERVICE_PRODUCT_CATEGORIES,
  isServiceProduct,
} from "@/domain/sale-pricing";
import { Prisma } from "@prisma/client";
import type { ServiceTransactionInput } from "@/schemas/money";

/** One of the shop's services (a service product) with its single commission rule. */
export interface ShopService {
  id: string;
  name: string;
  category: string;
  rule: ServiceCommissionRule;
  ruleText: string;
}

export interface ServiceTransactionView {
  id: string;
  serviceKey: string;
  label: string;
  category: string;
  categoryLabel: string;
  provider: string;
  direction: "send" | "receive";
  amountPiasters: number;
  commissionPiasters: number;
  commissionMode: CommissionMode;
  customerPiasters: number;
  floatDeltaPiasters: number;
  floatMachine: string;
  payment: string;
  status: "completed" | "cancelled";
  reference: string | null;
  note: string | null;
  at: string;
  cancelledAt: string | null;
}

type Row = Awaited<ReturnType<typeof findRow>>;
async function findRow(
  tx: TenantTx,
  storeId: string,
  where: { id?: string; opId?: string },
) {
  return tx.serviceTransaction.findFirst({
    where: { storeId, ...where },
    include: {
      floatMachine: { select: { name: true } },
      paymentMachine: { select: { name: true } },
    },
  });
}

function view(r: NonNullable<Row>): ServiceTransactionView {
  const def = SERVICE_BY_KEY.get(r.serviceKey);
  return {
    id: r.id,
    serviceKey: r.serviceKey,
    label: def?.label ?? r.serviceType,
    category: r.category,
    categoryLabel:
      SERVICE_CATEGORY_LABELS[r.category as ServiceCategory] ?? r.category,
    provider: r.provider,
    direction: r.direction as "send" | "receive",
    amountPiasters: Number(r.amountPiasters),
    commissionPiasters: Number(r.commissionPiasters),
    commissionMode: r.commissionMode as CommissionMode,
    customerPiasters: Number(r.customerPiasters),
    floatDeltaPiasters: Number(r.floatDeltaPiasters),
    floatMachine: r.floatMachine.name,
    payment: r.paymentCash ? "الدرج (كاش)" : (r.paymentMachine?.name ?? "—"),
    status: r.status as "completed" | "cancelled",
    reference: r.reference,
    note: r.note,
    at: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  };
}

/** The shop's services (service products) with their one commission rule each. */
export async function listShopServices(
  storeId: string,
  userId: string,
): Promise<ShopService[]> {
  const config = await getSalesViewConfig(storeId, userId);
  const products = await withTenant(storeId, userId, (tx) =>
    tx.storeProduct.findMany({
      where: {
        storeId,
        isActive: true,
        OR: [
          { unit: "service" },
          { category: { in: [...SERVICE_PRODUCT_CATEGORIES] } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        nameAr: true,
        category: true,
        sellPricePiasters: true,
        globalProduct: { select: { nameAr: true } },
      },
    }),
  );
  return products.map((p) => {
    const rule = serviceRuleOf(
      config.serviceCommissions,
      p.id,
      Number(p.sellPricePiasters),
    );
    return {
      id: p.id,
      name: p.nameAr || p.globalProduct?.nameAr || "خدمة",
      category: p.category,
      rule,
      ruleText: describeCommission(rule),
    };
  });
}

/**
 * Records a service the owner performed. Idempotent by `opId`.
 * @throws 400 commission outside the rule / larger than allowed, float too low (rolled back);
 *   404 unknown machine; 409 the same opId with different content.
 */
export async function recordServiceTransaction(
  storeId: string,
  userId: string,
  input: ServiceTransactionInput,
): Promise<ServiceTransactionView & { duplicate: boolean }> {
  const config = await getSalesViewConfig(storeId, userId);
  const product = await withTenant(storeId, userId, (tx) =>
    tx.storeProduct.findFirst({
      where: { storeId, id: input.serviceProductId },
      select: {
        id: true,
        nameAr: true,
        category: true,
        unit: true,
        isActive: true,
        sellPricePiasters: true,
        globalProduct: { select: { nameAr: true } },
      },
    }),
  );
  if (!product || !product.isActive) {
    throw AppError.notFound("الخدمة دي مش موجودة");
  }
  if (!isServiceProduct(product)) {
    throw AppError.badRequest("ده منتج مش خدمة");
  }
  const name = (
    product.nameAr ||
    product.globalProduct?.nameAr ||
    "خدمة"
  ).slice(0, 60);
  const direction = input.direction;
  // The cashier's model, for both directions: the customer pays the commission on top of a send,
  // and it is kept from what the customer receives.
  const mode: CommissionMode = "customer_fee";
  const rule = serviceRuleOf(
    config.serviceCommissions,
    product.id,
    Number(product.sellPricePiasters),
  );
  const fromRule = slabFor(rule, input.amountPiasters)?.piasters;
  const commission = input.commissionPiasters ?? fromRule;
  if (commission === undefined) {
    throw new AppError(
      "VALIDATION_ERROR",
      "المبلغ ده برة شرائح العمولة اللي حددتها للخدمة دي. اكتب العمولة بنفسك أو عدّل الشرائح.",
      400,
      { field: "commissionPiasters" },
    );
  }
  let money;
  try {
    money = serviceMoney(direction, mode, input.amountPiasters, commission);
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "العمولة أكبر من مبلغ العملية",
      400,
      { field: "commissionPiasters" },
    );
  }
  const paymentMachineId =
    input.payment === "cash" ? null : input.payment.machineId;

  return withTenant(storeId, userId, async (tx) => {
    const existing = await findRow(tx, storeId, { opId: input.opId });
    if (existing) {
      if (
        existing.serviceKey !== product.id ||
        existing.amountPiasters !== BigInt(input.amountPiasters) ||
        existing.floatMachineId !== input.floatMachineId
      ) {
        throw AppError.conflict("رقم العملية ده اتسجل قبل كده لخدمة مختلفة");
      }
      return { ...view(existing), duplicate: true };
    }
    // Both accounts must be this shop's (checked before anything is written: a foreign id is a
    // 404, whatever the foreign key would accept).
    const ids = [input.floatMachineId, paymentMachineId].filter(
      (x): x is string => x !== null,
    );
    const owned = await tx.posMachine.count({
      where: { storeId, id: { in: ids } },
    });
    if (owned !== ids.length) {
      throw AppError.notFound("الماكينة أو المحفظة دي مش موجودة");
    }
    const created = await tx.serviceTransaction.create({
      data: {
        storeId,
        opId: input.opId,
        // The service product (its id) — label, category and rule come from it.
        serviceKey: product.id,
        category: product.category.slice(0, 40),
        provider: name,
        serviceType: name.slice(0, 40),
        direction,
        amountPiasters: BigInt(input.amountPiasters),
        commissionPiasters: BigInt(commission),
        commissionMode: mode,
        customerPiasters: BigInt(money.customerPiasters),
        floatDeltaPiasters: BigInt(money.floatDeltaPiasters),
        floatMachineId: input.floatMachineId,
        paymentCash: paymentMachineId === null,
        paymentMachineId,
        reference: input.reference?.trim() || null,
        note: input.note?.trim() || null,
        createdBy: userId,
      },
    });
    // The float: out for a send (no overdraft), in for a receive.
    if (money.floatDeltaPiasters !== 0) {
      await changeMachineBalanceInTx(
        tx,
        storeId,
        input.floatMachineId,
        { kind: "delta", amountPiasters: money.floatDeltaPiasters },
        {
          source: `خدمة: ${name}`,
          reference: created.id,
        },
      );
    }
    // The customer's side through a wallet (the drawer side is read by the drawer).
    if (paymentMachineId && money.customerPiasters > 0) {
      await changeMachineBalanceInTx(
        tx,
        storeId,
        paymentMachineId,
        {
          kind: "delta",
          amountPiasters:
            direction === "send"
              ? money.customerPiasters
              : -money.customerPiasters,
        },
        {
          source: `${direction === "send" ? "دفع خدمة" : "صرف خدمة"}: ${name}`,
          reference: created.id,
        },
      );
    }
    const row = await findRow(tx, storeId, { id: created.id });
    return { ...view(row!), duplicate: false };
  });
}

/**
 * Cancels a recorded service in Hesba's books (a mistake, or the provider refused it): the
 * float and the wallet get their money back; the drawer stops counting it. Idempotent.
 */
export async function cancelServiceTransaction(
  storeId: string,
  userId: string,
  id: string,
): Promise<ServiceTransactionView> {
  return withTenant(storeId, userId, async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM service_transactions
       WHERE id = ${id}::uuid AND store_id = ${storeId}::uuid FOR UPDATE`;
    if (!locked[0]) throw AppError.notFound("العملية دي مش موجودة");
    const r = await findRow(tx, storeId, { id });
    if (!r) throw AppError.notFound("العملية دي مش موجودة");
    if (r.status === "cancelled") return view(r);
    const label = SERVICE_BY_KEY.get(r.serviceKey)?.label ?? r.serviceType;
    if (r.floatDeltaPiasters !== BigInt(0)) {
      await changeMachineBalanceInTx(
        tx,
        storeId,
        r.floatMachineId,
        { kind: "delta", amountPiasters: -Number(r.floatDeltaPiasters) },
        { source: `إلغاء خدمة: ${label}`, reference: r.id },
      );
    }
    if (r.paymentMachineId && r.customerPiasters > BigInt(0)) {
      await changeMachineBalanceInTx(
        tx,
        storeId,
        r.paymentMachineId,
        {
          kind: "delta",
          amountPiasters:
            r.direction === "send"
              ? -Number(r.customerPiasters)
              : Number(r.customerPiasters),
        },
        { source: `إلغاء خدمة: ${label}`, reference: r.id },
      );
    }
    await tx.serviceTransaction.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: new Date() },
    });
    return view((await findRow(tx, storeId, { id }))!);
  });
}

export async function listServiceTransactions(
  storeId: string,
  userId: string,
  opts: { from?: Date; to?: Date; limit?: number } = {},
) {
  return withTenant(storeId, userId, async (tx) => {
    const rows = await tx.serviceTransaction.findMany({
      where: {
        storeId,
        createdAt: {
          ...(opts.from ? { gte: opts.from } : {}),
          ...(opts.to ? { lt: opts.to } : {}),
        },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(opts.limit ?? 50, 200),
      include: {
        floatMachine: { select: { name: true } },
        paymentMachine: { select: { name: true } },
      },
    });
    const summary = await serviceSummaryInRange(
      tx,
      storeId,
      opts.from ?? null,
      opts.to ?? new Date(Date.now() + 1),
    );
    return { items: rows.map(view), summary };
  });
}

/**
 * Completed services of a period: count, operations' value (NOT revenue), commissions — the
 * services page's operations AND the services sold at the cashier (ADR-0035), so «كسبت كام من
 * الخدمات؟» has one answer everywhere (the report's `serviceCommissionsPiasters` adds the same
 * two parts).
 * - cashier: a sale line of a service product, voided sales excluded, returns netted; its
 *   commission is what the customer paid − what the machine paid out (lines whose machine charge
 *   is not recorded are counted in `unknownCommissionCount`, never guessed).
 */
export async function serviceSummaryInRange(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<{
  count: number;
  amountPiasters: number;
  commissionPiasters: number;
  byCategory: Array<{
    category: string;
    label: string;
    count: number;
    commissionPiasters: number;
  }>;
  cashier: {
    count: number;
    paidPiasters: number;
    commissionPiasters: number;
    unknownCommissionCount: number;
  };
}> {
  const rows = await tx.serviceTransaction.groupBy({
    by: ["category"],
    where: {
      storeId,
      status: "completed",
      createdAt: { ...(from ? { gte: from } : {}), lt: to },
    },
    _sum: { amountPiasters: true, commissionPiasters: true },
    _count: true,
  });
  const cashierRows = await tx.$queryRaw<
    Array<{
      count: bigint;
      paid: bigint | null;
      known_paid: bigint | null;
      known_cost: bigint | null;
      unknown: bigint;
    }>
  >`
    WITH line AS (
      SELECT sl.total_piasters
               - COALESCE((SELECT SUM(r.amount_piasters) FROM sale_return_lines r
                            WHERE r.store_id = sl.store_id AND r.sale_line_id = sl.id), 0) AS paid,
             sl.cost_piasters AS cost
        FROM sale_lines sl
        JOIN sales s ON s.id = sl.sale_id AND s.store_id = sl.store_id
        LEFT JOIN store_variants v ON v.id = sl.store_variant_id
        JOIN store_products p ON p.id = COALESCE(sl.store_product_id, v.store_product_id)
       WHERE sl.store_id = ${storeId}::uuid
         AND s.created_at < ${to}
         AND (${from}::timestamptz IS NULL OR s.created_at >= ${from}::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM sale_voids sv
                          WHERE sv.store_id = s.store_id AND sv.sale_id = s.id)
         AND (p.unit = 'service'
              OR p.category IN (${Prisma.join([...SERVICE_PRODUCT_CATEGORIES])}))
    )
    SELECT COUNT(*)::bigint AS count,
           SUM(paid)::bigint AS paid,
           SUM(paid) FILTER (WHERE cost IS NOT NULL)::bigint AS known_paid,
           SUM(cost) FILTER (WHERE cost IS NOT NULL)::bigint AS known_cost,
           COUNT(*) FILTER (WHERE cost IS NULL)::bigint AS unknown
      FROM line`;
  const c = cashierRows[0];
  const cashier = {
    count: Number(c?.count ?? 0),
    paidPiasters: Number(c?.paid ?? 0),
    commissionPiasters: Number(c?.known_paid ?? 0) - Number(c?.known_cost ?? 0),
    unknownCommissionCount: Number(c?.unknown ?? 0),
  };
  const byCategory = rows
    .map((r) => ({
      category: r.category,
      label:
        SERVICE_CATEGORY_LABELS[r.category as ServiceCategory] ?? r.category,
      count: r._count,
      commissionPiasters: Number(r._sum.commissionPiasters ?? 0),
    }))
    .sort((a, b) => b.commissionPiasters - a.commissionPiasters);
  return {
    count: rows.reduce((s, r) => s + r._count, 0) + cashier.count,
    amountPiasters:
      rows.reduce((s, r) => s + Number(r._sum.amountPiasters ?? 0), 0) +
      Number(c?.known_cost ?? 0),
    commissionPiasters:
      byCategory.reduce((s, r) => s + r.commissionPiasters, 0) +
      cashier.commissionPiasters,
    byCategory,
    cashier,
  };
}
