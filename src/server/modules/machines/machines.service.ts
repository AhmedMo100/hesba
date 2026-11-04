import "server-only";
import { type DatabaseInstance } from "@/server/infra/db/client";
import { withTenant } from "@/server/infra/db/tenant";
import { AppError } from "@/server/platform/error";

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
   * Adds a topup / balance deposit to a POS machine.
   */
  async topupMachine(
    storeId: string,
    userId: string | null,
    machineId: string,
    amountPiasters: number,
    params?: {
      source?: string | null;
      reference?: string | null;
      notes?: string | null;
    },
  ): Promise<PosMachineDto> {
    if (amountPiasters <= 0) {
      throw AppError.badRequest("قيمة الشحن يجب أن تكون أكبر من صفر");
    }

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const machine = await tx.posMachine.findFirst({
          where: { id: machineId, storeId, deletedAt: null },
        });

        if (!machine) {
          throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها");
        }

        const newBalance =
          Number(machine.currentBalancePiasters) + amountPiasters;

        await tx.posMachineTopup.create({
          data: {
            storeId,
            machineId,
            amountPiasters: BigInt(amountPiasters),
            balanceAfterPiasters: BigInt(newBalance),
            source: params?.source?.trim() || "إيداع رصيد ماكينة",
            reference: params?.reference?.trim() || null,
            notes: params?.notes?.trim() || null,
          },
        });

        const updated = await tx.posMachine.update({
          where: { id: machineId },
          data: {
            currentBalancePiasters: BigInt(newBalance),
          },
          include: {
            topups: {
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
        });

        return {
          id: updated.id,
          name: updated.name,
          provider: updated.provider,
          terminalId: updated.terminalId,
          status: updated.status as "active" | "inactive" | "maintenance",
          notes: updated.notes,
          currentBalancePiasters: Number(updated.currentBalancePiasters),
          balanceTransactions: updated.topups.map((t) => ({
            id: t.id,
            type: "deposit" as const,
            amountPiasters: Number(t.amountPiasters),
            balanceAfterPiasters: Number(t.balanceAfterPiasters),
            source: t.source,
            reference: t.reference,
            notes: t.notes,
            createdAt: t.createdAt.toISOString(),
          })),
          createdAt: updated.createdAt.toISOString(),
        };
      },
      this.db,
    );
  }

  /**
   * Adjusts / sets the exact balance of a POS machine (correction / audit).
   */
  async adjustMachineBalance(
    storeId: string,
    userId: string | null,
    machineId: string,
    targetBalancePiasters: number,
    params?: {
      source?: string | null;
      reason?: string | null;
      reference?: string | null;
      notes?: string | null;
    },
  ): Promise<PosMachineDto> {
    if (targetBalancePiasters < 0) {
      throw AppError.badRequest("رصيد الماكينة لا يمكن أن يكون سالباً");
    }

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const machine = await tx.posMachine.findFirst({
          where: { id: machineId, storeId, deletedAt: null },
        });

        if (!machine) {
          throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها");
        }

        const currentBalance = Number(machine.currentBalancePiasters);
        const delta = targetBalancePiasters - currentBalance;

        await tx.posMachineTopup.create({
          data: {
            storeId,
            machineId,
            amountPiasters: BigInt(delta),
            balanceAfterPiasters: BigInt(targetBalancePiasters),
            source:
              params?.source?.trim() ||
              (delta >= 0 ? "تصحيح رصيد (زيادة)" : "تصحيح رصيد (تخفيض)"),
            reference: params?.reference?.trim() || null,
            notes:
              params?.notes?.trim() ||
              params?.reason?.trim() ||
              "تعديل رصيد يدوي",
          },
        });

        const updated = await tx.posMachine.update({
          where: { id: machineId },
          data: {
            currentBalancePiasters: BigInt(targetBalancePiasters),
          },
          include: {
            topups: {
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
        });

        return {
          id: updated.id,
          name: updated.name,
          provider: updated.provider,
          terminalId: updated.terminalId,
          status: updated.status as "active" | "inactive" | "maintenance",
          notes: updated.notes,
          currentBalancePiasters: Number(updated.currentBalancePiasters),
          balanceTransactions: updated.topups.map((t) => ({
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
          createdAt: updated.createdAt.toISOString(),
        };
      },
      this.db,
    );
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
   * Deducts balance from a POS machine upon executing a bill or service sale.
   * Atomically checks balance and updates history.
   */
  async deductMachineBalance(
    storeId: string,
    userId: string | null,
    machineId: string,
    amountPiasters: number,
    params?: {
      source?: string | null;
      reference?: string | null;
      notes?: string | null;
    },
  ): Promise<PosMachineDto> {
    if (amountPiasters <= 0) {
      throw AppError.badRequest("قيمة الخصم يجب أن تكون أكبر من صفر");
    }

    return await withTenant(
      storeId,
      userId,
      async (tx) => {
        const machine = await tx.posMachine.findFirst({
          where: { id: machineId, storeId, deletedAt: null },
        });

        if (!machine) {
          throw AppError.notFound("ماكينة الدفع غير موجودة أو تم حذفها");
        }

        const currentBalance = Number(machine.currentBalancePiasters);
        if (currentBalance < amountPiasters) {
          throw AppError.badRequest(
            `رصيد ماكينة ${machine.name} غير كافٍ. المتاح: ${(currentBalance / 100).toFixed(2)} ج.م والمطلوب: ${(amountPiasters / 100).toFixed(2)} ج.م`,
          );
        }

        const newBalance = currentBalance - amountPiasters;

        await tx.posMachineTopup.create({
          data: {
            storeId,
            machineId,
            amountPiasters: BigInt(-amountPiasters),
            balanceAfterPiasters: BigInt(newBalance),
            source: params?.source?.trim() || "تنفيذ عملية بيع خدمة / شحن",
            reference: params?.reference?.trim() || null,
            notes: params?.notes?.trim() || null,
          },
        });

        const updated = await tx.posMachine.update({
          where: { id: machineId },
          data: {
            currentBalancePiasters: BigInt(newBalance),
          },
          include: {
            topups: {
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
        });

        return {
          id: updated.id,
          name: updated.name,
          provider: updated.provider,
          terminalId: updated.terminalId,
          status: updated.status as "active" | "inactive" | "maintenance",
          notes: updated.notes,
          currentBalancePiasters: Number(updated.currentBalancePiasters),
          balanceTransactions: updated.topups.map((t) => ({
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
          createdAt: updated.createdAt.toISOString(),
        };
      },
      this.db,
    );
  }
}
