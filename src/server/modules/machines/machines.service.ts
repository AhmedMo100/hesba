import "server-only";

/**
 * @file machines.service.ts
 * @description POS machines (e-payment / top-up terminals) and their prepaid balances.
 *
 * @responsibility
 * List, create/update and soft-delete machines; top up, set (reconcile) and deduct a machine's
 * balance. Every balance change writes a `pos_machine_topups` history row (deductions are
 * negative amounts) together with the new `current_balance_piasters`.
 *
 * @usedBy
 * `src/app/api/machines/{route,topup,adjust,deduct}/route.ts`.
 *
 * @remarks
 * Money safety (ADR-0020, audit QA-03):
 * - Every balance change goes through `changeMachineBalanceInTx`: it locks the machine row
 *   (`SELECT … FOR UPDATE`), computes the new balance from the LOCKED value, and writes the
 *   ledger row and the new balance in the same transaction. Concurrent operations on one
 *   machine run one after the other, so none is lost.
 * - An operation may carry an `opId`; the same `opId` is applied at most once per store
 *   (unique `(store_id, op_id)` on the ledger, checked after the lock).
 * - A balance never goes below zero (rejected with 400; also a database check).
 * - A service sale deducts the machine inside the sale transaction (`modules/sales`).
 * Money is integer piasters.
 */

import { Prisma } from "@prisma/client";
import { type DatabaseInstance } from "@/server/infra/db/client";
import { withTenant, type TenantTx } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";

/** A balance change: add/subtract an amount, or set an exact balance (reconciliation). */
export type BalanceChange =
  | { kind: "delta"; amountPiasters: number }
  | { kind: "set"; targetPiasters: number };

export interface BalanceOperationMeta {
  opId?: string | null;
  source?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface MachineBalanceResult {
  machineId: string;
  machineName: string;
  balanceBeforePiasters: number;
  balanceAfterPiasters: number;
  /** The signed amount recorded in the ledger. */
  amountPiasters: number;
  ledgerId: string;
  /** True when this `opId` was already applied: nothing changed this time. */
  duplicate: boolean;
}

const MONEY_LIMIT = BigInt(Number.MAX_SAFE_INTEGER);

function formatEgp(piasters: bigint): string {
  return (Number(piasters) / 100).toFixed(2);
}

/**
 * Applies one balance change to a machine inside the caller's tenant transaction (ADR-0020):
 * 1. locks the machine row (`FOR UPDATE`) — a concurrent operation waits here;
 * 2. returns the earlier result when `opId` was already applied (after the lock, so a
 *    concurrent retry sees the first attempt's committed row);
 * 3. rejects a resulting balance below zero (400) — nothing is written;
 * 4. writes the ledger row and the new balance, both computed from the locked balance.
 *
 * @throws AppError 404 (no such machine in this store, or deleted), 400 (insufficient
 *   balance / invalid amount), 409 (the `opId` belongs to an operation on another machine).
 */
export async function changeMachineBalanceInTx(
  tx: TenantTx,
  storeId: string,
  machineId: string,
  change: BalanceChange,
  meta: BalanceOperationMeta = {},
): Promise<MachineBalanceResult> {
  const amount =
    change.kind === "delta" ? change.amountPiasters : change.targetPiasters;
  if (!Number.isSafeInteger(amount)) {
    throw AppError.badRequest("المبلغ لازم يكون بالقروش (رقم صحيح)");
  }

  const rows = await tx.$queryRaw<
    Array<{ id: string; name: string; current_balance_piasters: bigint }>
  >`SELECT id::text AS id, name, current_balance_piasters
      FROM pos_machines
     WHERE id = ${machineId}::uuid
       AND store_id = ${storeId}::uuid
       AND deleted_at IS NULL
       FOR UPDATE`;
  const machine = rows[0];
  if (!machine) {
    throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها");
  }
  const before = BigInt(machine.current_balance_piasters);

  if (meta.opId) {
    const existing = await tx.posMachineTopup.findFirst({
      where: { storeId, opId: meta.opId },
    });
    if (existing) {
      if (existing.machineId !== machineId) {
        throw AppError.conflict("العملية دي اتسجلت قبل كده على ماكينة تانية");
      }
      return {
        machineId,
        machineName: machine.name,
        balanceBeforePiasters: Number(
          existing.balanceAfterPiasters - existing.amountPiasters,
        ),
        balanceAfterPiasters: Number(existing.balanceAfterPiasters),
        amountPiasters: Number(existing.amountPiasters),
        ledgerId: existing.id,
        duplicate: true,
      };
    }
  }

  const delta =
    change.kind === "delta"
      ? BigInt(change.amountPiasters)
      : BigInt(change.targetPiasters) - before;
  if (change.kind === "delta" && delta === BigInt(0)) {
    throw AppError.badRequest("المبلغ لازم يكون أكبر من صفر");
  }
  const after = before + delta;
  if (after < BigInt(0)) {
    throw AppError.badRequest(
      change.kind === "set"
        ? "رصيد الماكينة لا يمكن أن يكون سالباً"
        : `رصيد ماكينة ${machine.name} غير كافٍ. المتاح: ${formatEgp(before)} ج.م والمطلوب: ${formatEgp(-delta)} ج.م`,
    );
  }
  if (after > MONEY_LIMIT) {
    throw AppError.badRequest("المبلغ كبير قوي");
  }

  const ledger = await tx.posMachineTopup.create({
    data: {
      storeId,
      machineId,
      amountPiasters: delta,
      balanceAfterPiasters: after,
      source:
        meta.source?.trim() ||
        (change.kind === "set"
          ? delta >= BigInt(0)
            ? "تصحيح رصيد (زيادة)"
            : "تصحيح رصيد (تخفيض)"
          : null),
      reference: meta.reference?.trim() || null,
      notes: meta.notes?.trim() || null,
      opId: meta.opId ?? null,
    },
    select: { id: true },
  });
  await tx.posMachine.update({
    where: { id: machineId },
    data: { currentBalancePiasters: after },
  });

  return {
    machineId,
    machineName: machine.name,
    balanceBeforePiasters: Number(before),
    balanceAfterPiasters: Number(after),
    amountPiasters: Number(delta),
    ledgerId: ledger.id,
    duplicate: false,
  };
}

async function loadMachineDtoInTx(
  tx: TenantTx,
  storeId: string,
  machineId: string,
): Promise<PosMachineDto> {
  const m = await tx.posMachine.findFirstOrThrow({
    where: { id: machineId, storeId },
    include: { topups: { orderBy: { createdAt: "desc" }, take: 20 } },
  });
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    terminalId: m.terminalId,
    status: m.status as "active" | "inactive" | "maintenance",
    notes: m.notes,
    currentBalancePiasters: Number(m.currentBalancePiasters),
    balanceTransactions: m.topups.map((t) => ({
      id: t.id,
      type:
        Number(t.amountPiasters) >= 0
          ? ("deposit" as const)
          : ("withdrawal" as const),
      amountPiasters: Number(t.amountPiasters),
      balanceAfterPiasters: Number(t.balanceAfterPiasters),
      source: t.source,
      reference: t.reference,
      notes: t.notes,
      createdAt: t.createdAt.toISOString(),
    })),
    createdAt: m.createdAt.toISOString(),
  };
}

export interface PosMachineDto {
  id: string;
  name: string;
  provider: string;
  terminalId?: string | null;
  status: "active" | "inactive" | "maintenance";
  notes?: string | null;
  currentBalancePiasters: number;
  balanceTransactions: Array<{
    id: string;
    type: "deposit" | "withdrawal" | "settlement" | "adjustment";
    amountPiasters: number;
    balanceAfterPiasters: number;
    source?: string | null;
    reference?: string | null;
    notes?: string | null;
    createdAt: string;
  }>;
  createdAt: string;
}

export class MachinesService {
  constructor(private readonly db: DatabaseInstance) {}

  /**
   * Returns all active POS machines for the tenant store.
   * If the store hasn't added any machines yet, returns an empty list.
   */
  async getStoreMachines(
    storeId: string,
    userId: string | null,
  ): Promise<PosMachineDto[]> {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const machines = await tx.posMachine.findMany({
          where: { storeId, deletedAt: null },
          include: {
            topups: {
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
          orderBy: { createdAt: "asc" },
        });

        return machines.map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          terminalId: m.terminalId,
          status: m.status as "active" | "inactive" | "maintenance",
          notes: m.notes,
          currentBalancePiasters: Number(m.currentBalancePiasters),
          balanceTransactions: m.topups.map((t) => ({
            id: t.id,
            type: "deposit" as const,
            amountPiasters: Number(t.amountPiasters),
            balanceAfterPiasters: Number(t.balanceAfterPiasters),
            source: t.source,
            reference: t.reference,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
          })),
          createdAt: m.createdAt.toISOString(),
        }));
      },
      this.db,
    );
  }

  /**
   * Creates or updates a POS machine inside the tenant store.
   */
  async upsertMachine(
    storeId: string,
    userId: string | null,
    input: {
      id?: string;
      name: string;
      provider: string;
      terminalId?: string | null;
      status?: "active" | "inactive" | "maintenance";
      notes?: string | null;
    },
  ): Promise<PosMachineDto> {
    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        let machine;
        if (input.id) {
          const existing = await tx.posMachine.findFirst({
            where: { id: input.id, storeId, deletedAt: null },
          });
          if (!existing) {
            throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها");
          }

          machine = await tx.posMachine.update({
            where: { id: input.id },
            data: {
              name: input.name.trim(),
              provider: input.provider.trim(),
              terminalId: input.terminalId?.trim() || null,
              status: input.status || existing.status,
              notes: input.notes?.trim() || null,
            },
            include: {
              topups: {
                orderBy: { createdAt: "desc" },
                take: 20,
              },
            },
          });
        } else {
          machine = await tx.posMachine.create({
            data: {
              storeId,
              name: input.name.trim(),
              provider: input.provider.trim(),
              terminalId: input.terminalId?.trim() || null,
              status: input.status || "active",
              notes: input.notes?.trim() || null,
              currentBalancePiasters: BigInt(0),
            },
            include: {
              topups: true,
            },
          });
        }

        return {
          id: machine.id,
          name: machine.name,
          provider: machine.provider,
          terminalId: machine.terminalId,
          status: machine.status as "active" | "inactive" | "maintenance",
          notes: machine.notes,
          currentBalancePiasters: Number(machine.currentBalancePiasters),
          balanceTransactions: machine.topups.map((t) => ({
            id: t.id,
            type: "deposit" as const,
            amountPiasters: Number(t.amountPiasters),
            balanceAfterPiasters: Number(t.balanceAfterPiasters),
            source: t.source,
            reference: t.reference,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
          })),
          createdAt: machine.createdAt.toISOString(),
        };
      },
      this.db,
    );
  }

  /**
   * Adds a top-up (deposit) to a machine. Locked and idempotent by `opId` (ADR-0020).
   */
  async topupMachine(
    storeId: string,
    userId: string | null,
    machineId: string,
    amountPiasters: number,
    params?: BalanceOperationMeta,
  ): Promise<PosMachineDto & { duplicate: boolean }> {
    return this.runBalanceOperation(storeId, userId, machineId, {
      change: { kind: "delta", amountPiasters },
      meta: {
        ...params,
        source: params?.source?.trim() || "إيداع رصيد ماكينة",
      },
    });
  }

  /**
   * Sets the exact balance of a machine (reconciliation). The ledger row records the
   * difference from the locked current balance. Locked and idempotent by `opId`.
   */
  async adjustMachineBalance(
    storeId: string,
    userId: string | null,
    machineId: string,
    targetBalancePiasters: number,
    params?: BalanceOperationMeta & { reason?: string | null },
  ): Promise<PosMachineDto & { duplicate: boolean }> {
    return this.runBalanceOperation(storeId, userId, machineId, {
      change: { kind: "set", targetPiasters: targetBalancePiasters },
      meta: {
        ...params,
        notes:
          params?.notes?.trim() || params?.reason?.trim() || "تعديل رصيد يدوي",
      },
    });
  }

  /**
   * Soft deletes a POS machine.
   */
  async deleteMachine(
    storeId: string,
    userId: string | null,
    machineId: string,
  ): Promise<void> {
    await withTenant(
      storeId,
      userId,
      async (tx) => {
        const machine = await tx.posMachine.findFirst({
          where: { id: machineId, storeId, deletedAt: null },
        });

        if (!machine) {
          throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها بالفعل");
        }

        await tx.posMachine.update({
          where: { id: machineId },
          data: { deletedAt: new Date() },
        });
      },
      this.db,
    );
  }

  /**
   * Deducts from a machine (a bill or service paid through it). Rejects an amount above the
   * balance (no overdraft). Locked and idempotent by `opId` (ADR-0020).
   *
   * @throws AppError 400 (insufficient balance), 404 (unknown or deleted machine).
   */
  async deductMachineBalance(
    storeId: string,
    userId: string | null,
    machineId: string,
    amountPiasters: number,
    params?: BalanceOperationMeta,
  ): Promise<PosMachineDto & { duplicate: boolean }> {
    return this.runBalanceOperation(storeId, userId, machineId, {
      change: { kind: "delta", amountPiasters: -amountPiasters },
      meta: {
        ...params,
        source: params?.source?.trim() || "تنفيذ عملية بيع خدمة / شحن",
      },
    });
  }

  private async runBalanceOperation(
    storeId: string,
    userId: string | null,
    machineId: string,
    op: { change: BalanceChange; meta: BalanceOperationMeta },
  ): Promise<PosMachineDto & { duplicate: boolean }> {
    try {
      return await withTenant(
        storeId,
        userId,
        async (tx) => {
          const result = await changeMachineBalanceInTx(
            tx,
            storeId,
            machineId,
            op.change,
            op.meta,
          );
          const dto = await loadMachineDtoInTx(tx, storeId, machineId);
          return { ...dto, duplicate: result.duplicate };
        },
        this.db,
      );
    } catch (err) {
      // The same opId was committed by a concurrent request on another machine row: report
      // a conflict instead of a 500 (on the same machine the lock already serializes them).
      if (
        op.meta.opId &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw AppError.conflict("العملية دي اتسجلت قبل كده");
      }
      throw err;
    }
  }
}
