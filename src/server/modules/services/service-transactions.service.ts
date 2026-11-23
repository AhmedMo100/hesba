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
 * - The commission is computed on the server from the shop's rule (or typed by the owner) and
 *   stored on the transaction: later rule changes never rewrite history.
 * - Atomic and idempotent by `opId`; the float never goes negative (a send larger than the float
 *   is a 400 and nothing is recorded).
 * - Hesba has no provider API: the owner records an operation AFTER it went through on the
 *   provider's app / machine. Cancelling reverses Hesba's books only — it never claims the
 *   provider reversed anything.
 */

import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { changeMachineBalanceInTx } from "@/server/modules/machines";
import {
  readStoreSettings,
  updateStoreSettings,
} from "@/server/modules/tenancy";
import {
  SERVICE_BY_KEY,
  SERVICE_CATEGORY_LABELS,
  SERVICES,
  serviceMoney,
  type CommissionMode,
  type ServiceCategory,
} from "@/domain/services-catalog";
import {
  slabFor,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import type {
  ServiceRulesInput,
  ServiceTransactionInput,
} from "@/schemas/money";

export interface ServiceRule {
  mode: CommissionMode;
  rule: ServiceCommissionRule;
}
export type ServiceRules = Record<string, ServiceRule>;

const SETTINGS_KEY = "serviceRules";

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

export async function getServiceRules(
  storeId: string,
  userId: string,
): Promise<ServiceRules> {
  const settings = await readStoreSettings(storeId, userId);
  return (settings[SETTINGS_KEY] as ServiceRules | undefined) ?? {};
}

/** Merges rules (null removes one). Only the owner's screen calls it; validated by the schema. */
export async function saveServiceRules(
  storeId: string,
  userId: string,
  input: ServiceRulesInput,
): Promise<ServiceRules> {
  return updateStoreSettings(storeId, userId, (settings) => {
    const saved = {
      ...((settings[SETTINGS_KEY] as ServiceRules | undefined) ?? {}),
    };
    for (const [key, value] of Object.entries(input.rules)) {
      if (value === null) delete saved[key];
      else
        saved[key] = {
          mode: value.mode,
          rule: value.rule as ServiceCommissionRule,
        };
    }
    return { patch: { [SETTINGS_KEY]: saved }, result: saved };
  });
}

/** The commission the rule gives (undefined: the amount is outside every slab of the rule). */
export function commissionFromRule(
  rule: ServiceRule | undefined,
  amountPiasters: number,
): number | undefined {
  if (!rule) return 0;
  return slabFor(rule.rule, amountPiasters)?.piasters;
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
  const def = SERVICE_BY_KEY.get(input.serviceKey);
  if (!def) throw AppError.badRequest("اختار الخدمة");
  const rules = await getServiceRules(storeId, userId);
  const rule = rules[input.serviceKey];
  const mode: CommissionMode = rule?.mode ?? def.defaultMode;
  const fromRule = commissionFromRule(rule, input.amountPiasters);
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
    money = serviceMoney(def.direction, mode, input.amountPiasters, commission);
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
        existing.serviceKey !== input.serviceKey ||
        existing.amountPiasters !== BigInt(input.amountPiasters) ||
        existing.floatMachineId !== input.floatMachineId
      ) {
        throw AppError.conflict("رقم العملية ده اتسجل قبل كده لخدمة مختلفة");
      }
      return { ...view(existing), duplicate: true };
    }
    const created = await tx.serviceTransaction.create({
      data: {
        storeId,
        opId: input.opId,
        serviceKey: def.key,
        category: def.category,
        provider: input.provider.trim(),
        serviceType: def.serviceType,
        direction: def.direction,
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
          source: `خدمة: ${def.label} (${input.provider.trim()})`,
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
            def.direction === "send"
              ? money.customerPiasters
              : -money.customerPiasters,
        },
        {
          source: `${def.direction === "send" ? "دفع خدمة" : "صرف خدمة"}: ${def.label}`,
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
    return { items: rows.map(view), summary, catalog: SERVICES };
  });
}

/** Completed services of a period: count, operations' value (NOT revenue), commissions. */
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
    count: rows.reduce((s, r) => s + r._count, 0),
    amountPiasters: rows.reduce(
      (s, r) => s + Number(r._sum.amountPiasters ?? 0),
      0,
    ),
    commissionPiasters: byCategory.reduce(
      (s, r) => s + r.commissionPiasters,
      0,
    ),
    byCategory,
  };
}
