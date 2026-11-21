import { z } from "zod";
import { businessDateSchema } from "./dates";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

const piasters = (message: string) =>
  z
    .number({ message })
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .min(0, "المبلغ مينفعش يبقى سالب")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي");

/**
 * `POST /api/daily-sales` (ADR-0033, إدارة المحل): the day's sales as one total, split by how it
 * was paid — the cash part (the drawer) and a part per machine / wallet of the shop.
 */
export const dailySalesInputSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    /** The Cairo day the total is for (default: today); never in the future. */
    businessDay: businessDateSchema.optional(),
    cashPiasters: piasters("مبلغ الكاش غير صحيح").default(0),
    parts: z
      .array(
        z
          .object({
            machineId: z.string().uuid("المحفظة غير صحيحة"),
            amountPiasters: piasters("مبلغ المحفظة غير صحيح").positive(
              "مبلغ المحفظة لازم يكون أكبر من صفر",
            ),
          })
          .strict(),
      )
      .max(20, "محافظ كتير قوي")
      .default([]),
    note: z
      .string()
      .trim()
      .max(300, "الملاحظة طويلة قوي")
      .optional()
      .nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.cashPiasters + v.parts.reduce((s, p) => s + p.amountPiasters, 0) > 0,
    { message: "اكتب مبيعات اليوم", path: ["cashPiasters"] },
  )
  .refine(
    (v) => new Set(v.parts.map((p) => p.machineId)).size === v.parts.length,
    { message: "المحفظة الواحدة مرة واحدة", path: ["parts"] },
  );

export type DailySalesInput = z.infer<typeof dailySalesInputSchema>;

export interface DailySalesEntryView {
  id: string;
  businessDay: string;
  totalPiasters: number;
  cashPiasters: number;
  parts: Array<{
    machineId: string;
    machineName: string;
    amountPiasters: number;
  }>;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
}
