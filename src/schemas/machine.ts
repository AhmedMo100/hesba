import { z } from "zod";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

/**
 * Bodies of the POS-machine money endpoints (ADR-0020). Amounts are integer piasters; a
 * decimal, a numeric string, NaN or an out-of-range value is a 400, never a 500.
 *
 * `opId` (uuid) makes the operation idempotent: the same `opId` is applied at most once per
 * store, so a retry after a lost response cannot charge the machine twice.
 */

/** Largest single machine operation: 10,000,000 EGP (keeps sums far inside bigint/JS limits). */
export const MAX_MACHINE_AMOUNT_PIASTERS = MAX_AMOUNT_PIASTERS;

const piasters = (message: string) =>
  z
    .number({ message })
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .max(MAX_MACHINE_AMOUNT_PIASTERS, "المبلغ كبير قوي");

const text = z.string().trim().max(500).optional().nullable();

export const machineTopupSchema = z.object({
  machineId: z.string().uuid("معرف الماكينة غير صحيح"),
  amountPiasters: piasters("قيمة الشحن غير صحيحة").positive(
    "قيمة الشحن يجب أن تكون أكبر من صفر",
  ),
  opId: z.string().uuid().optional(),
  source: text,
  reference: text,
  notes: text,
});

export const machineDeductSchema = z.object({
  machineId: z.string().uuid("معرف الماكينة غير صحيح"),
  amountPiasters: piasters("قيمة الخصم غير صحيحة").positive(
    "قيمة الخصم يجب أن تكون أكبر من صفر",
  ),
  opId: z.string().uuid().optional(),
  source: text,
  reference: text,
  notes: text,
});

export const machineAdjustSchema = z.object({
  machineId: z.string().uuid("معرف الماكينة غير صحيح"),
  targetBalancePiasters: piasters("الرصيد غير صحيح").min(
    0,
    "رصيد الماكينة لا يمكن أن يكون سالباً",
  ),
  opId: z.string().uuid().optional(),
  source: text,
  reason: text,
  reference: text,
  notes: text,
});

export type MachineTopupInput = z.infer<typeof machineTopupSchema>;
export type MachineDeductInput = z.infer<typeof machineDeductSchema>;
export type MachineAdjustInput = z.infer<typeof machineAdjustSchema>;

/**
 * Body of `POST /api/machines` (create, or update with `id`). A wrong type or a missing name
 * is a 400, never a 500 (QA-18/QA-19).
 */
export const upsertMachineSchema = z.object({
  id: z.string().uuid("معرف الماكينة غير صحيح").optional(),
  name: z.string().trim().min(1, "اكتب اسم الماكينة").max(200),
  provider: z.string().trim().min(1, "اختار نوع الماكينة").max(100),
  terminalId: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["active", "inactive", "maintenance"]).optional(),
  notes: text,
});

export type UpsertMachineInput = z.infer<typeof upsertMachineSchema>;
