import "server-only";

/**
 * @file money.service.ts
 * @description «فلوس حِسبة»: where the shop's money is. Reuses the existing ledgers — the drawer
 * (expected cash, ADR-0031) and the machines / wallets (`pos_machines` + `pos_machine_topups`) —
 * and adds only what none of them held: owner withdrawals, owner deposits and transfers
 * (`money_movements`).
 *
 * Rules:
 * - A transfer moves money between two of the shop's accounts: never income, never an expense.
 * - An owner withdrawal takes money out of the business: it is NOT an operating expense (the
 *   reports show it apart, and it never reduces profit).
 * - Append-only and idempotent by `opId`; a machine never goes negative (row lock, ADR-0020);
 *   the drawer side is read by the drawer's expected amount (`extraCashTotalsSince`).
 * - A mistake is corrected with the opposite movement, never by editing history.
 */

import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";
import { changeMachineBalanceInTx } from "@/server/modules/machines";
import { drawerExpectedInTx } from "@/server/modules/drawer";
import type {
  MoneyAccountView,
  MoneyMovementInput,
  MoneyMovementView,
  MoneyOverview,
} from "@/schemas/money";

export const MONEY_KIND_LABELS: Record<MoneyMovementInput["kind"], string> = {
  owner_withdrawal: "سحب شخصي من صاحب المحل",
  owner_deposit: "إيداع من صاحب المحل",
  transfer: "تحويل بين الحسابات",
};

const machineName = async (tx: TenantTx, storeId: string, id: string) => {
  const m = await tx.posMachine.findFirst({
    where: { storeId, id, deletedAt: null },
    select: { name: true },
  });
  if (!m) throw AppError.notFound("الحساب ده مش موجود أو اتحذف");
  return m.name;
};

function view(m: {
  id: string;
  kind: string;
  amountPiasters: bigint;
  fromCash: boolean;
  toCash: boolean;
  note: string | null;
  createdAt: Date;
  fromMachine?: { name: string } | null;
  toMachine?: { name: string } | null;
}): MoneyMovementView {
  const kind = m.kind as MoneyMovementInput["kind"];
  return {
    id: m.id,
    kind,
    label: MONEY_KIND_LABELS[kind] ?? "حركة فلوس",
    amountPiasters: Number(m.amountPiasters),
    from: m.fromCash ? "الدرج (كاش)" : (m.fromMachine?.name ?? null),
    to: m.toCash ? "الدرج (كاش)" : (m.toMachine?.name ?? null),
    note: m.note,
    at: m.createdAt.toISOString(),
  };
}

const movementInclude = {
  fromMachine: { select: { name: true } },
  toMachine: { select: { name: true } },
} as const;

/**
 * Records an owner withdrawal / deposit or a transfer, atomically and once per `opId`.
 * @throws 404 unknown machine; 400 a machine without enough balance (nothing is recorded);
 *   409 the same opId with different content.
 */
export async function recordMoneyMovement(
  storeId: string,
  userId: string | null,
  input: MoneyMovementInput,
): Promise<MoneyMovementView & { duplicate: boolean }> {
  return withTenant(storeId, userId, async (tx) => {
    const fromMachineId =
      input.from && input.from !== "cash" ? input.from.machineId : null;
    const toMachineId =
      input.to && input.to !== "cash" ? input.to.machineId : null;
    const existing = await tx.moneyMovement.findFirst({
      where: { storeId, opId: input.opId },
      include: movementInclude,
    });
    if (existing) {
      if (
        existing.kind !== input.kind ||
        existing.amountPiasters !== BigInt(input.amountPiasters) ||
        existing.fromMachineId !== fromMachineId ||
        existing.toMachineId !== toMachineId
      ) {
        throw AppError.conflict("رقم العملية ده اتسجل قبل كده بحركة مختلفة");
      }
      return { ...view(existing), duplicate: true };
    }
    const fromName = fromMachineId
      ? await machineName(tx, storeId, fromMachineId)
      : null;
    const toName = toMachineId
      ? await machineName(tx, storeId, toMachineId)
      : null;
    const created = await tx.moneyMovement.create({
      data: {
        storeId,
        opId: input.opId,
        kind: input.kind,
        amountPiasters: BigInt(input.amountPiasters),
        fromCash: input.from === "cash",
        fromMachineId,
        toCash: input.to === "cash",
        toMachineId,
        note: input.note?.trim() || null,
        createdBy: userId,
      },
      include: movementInclude,
    });
    const label = MONEY_KIND_LABELS[input.kind];
    // The machine side moves with the record or not at all (no overdraft: 400, rolled back).
    if (fromMachineId) {
      await changeMachineBalanceInTx(
        tx,
        storeId,
        fromMachineId,
        { kind: "delta", amountPiasters: -input.amountPiasters },
        {
          source: toName
            ? `${label} → ${toName}`
            : input.to === "cash"
              ? `${label} → الدرج`
              : label,
          reference: created.id,
          notes: input.note?.trim() || null,
        },
      );
    }
    if (toMachineId) {
      await changeMachineBalanceInTx(
        tx,
        storeId,
        toMachineId,
        { kind: "delta", amountPiasters: input.amountPiasters },
        {
          source: fromName
            ? `${label} ← ${fromName}`
            : input.from === "cash"
              ? `${label} ← الدرج`
              : label,
          reference: created.id,
          notes: input.note?.trim() || null,
        },
      );
    }
    return { ...view(created), duplicate: false };
  });
}

/** «فلوس حِسبة»: every account's balance, the total, and the latest movements. */
export async function getMoneyOverview(
  storeId: string,
  userId: string | null,
): Promise<MoneyOverview> {
  return withTenant(storeId, userId, async (tx) => {
    // Only the drawer's expected cash: the screen's movement lists are not needed here.
    const expectedCash = await drawerExpectedInTx(tx, storeId);
    const machines = await tx.posMachine.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        provider: true,
        currentBalancePiasters: true,
      },
    });
    const movements = await tx.moneyMovement.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: movementInclude,
    });
    const activity = await tx.posMachineTopup.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        amountPiasters: true,
        balanceAfterPiasters: true,
        source: true,
        createdAt: true,
        machine: { select: { name: true } },
      },
    });
    const accounts: MoneyAccountView[] = [
      {
        id: "cash",
        kind: "cash",
        name: "فلوس الدرج",
        provider: null,
        balancePiasters: expectedCash,
      },
      ...machines.map((m) => ({
        id: m.id,
        kind: "machine" as const,
        name: m.name,
        provider: m.provider,
        balancePiasters: Number(m.currentBalancePiasters),
      })),
    ];
    return {
      accounts,
      totalPiasters: accounts.reduce((s, a) => s + (a.balancePiasters ?? 0), 0),
      // Always known now: the cash is computed from the shop's operations (kept for old clients).
      cashKnown: true,
      movements: movements.map(view),
      machineActivity: activity.map((a) => ({
        id: a.id,
        machine: a.machine.name,
        amountPiasters: Number(a.amountPiasters),
        balanceAfterPiasters: Number(a.balanceAfterPiasters),
        source: a.source,
        at: a.createdAt.toISOString(),
      })),
    };
  });
}

/** Owner withdrawals / deposits in a period (the reports show them apart from expenses). */
export async function ownerMoneyInRange(
  tx: TenantTx,
  storeId: string,
  from: Date | null,
  to: Date,
): Promise<{ withdrawalsPiasters: number; depositsPiasters: number }> {
  const rows = await tx.moneyMovement.groupBy({
    by: ["kind"],
    where: {
      storeId,
      kind: { in: ["owner_withdrawal", "owner_deposit"] },
      createdAt: { ...(from ? { gte: from } : {}), lt: to },
    },
    _sum: { amountPiasters: true },
  });
  const of = (k: string) =>
    Number(rows.find((r) => r.kind === k)?._sum.amountPiasters ?? 0);
  return {
    withdrawalsPiasters: of("owner_withdrawal"),
    depositsPiasters: of("owner_deposit"),
  };
}
