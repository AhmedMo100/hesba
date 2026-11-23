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
    /**
     * Sold on credit (آجل) to named customers today: part of the day's sales (revenue) and a
     * debt on each customer («ليك») — never cash. A later collection settles it; it is never a
     * second sale.
     */
    credits: z
      .array(
        z
          .object({
            customerId: z.string().uuid("الزبون غير صحيح"),
            amountPiasters: piasters("مبلغ الآجل غير صحيح").positive(
              "مبلغ الآجل لازم يكون أكبر من صفر",
            ),
          })
          .strict(),
      )
      .max(20, "زباين كتير قوي في تسجيل واحد")
      .default([]),
    /**
     * Optional: quantities of products sold, when the owner knows them. They take the stock
     * out (with its cost) but add NO money: the money is already in the amounts above.
     */
    items: z
      .array(
        z
          .object({
            variantId: z.string().uuid("الصنف غير صحيح"),
            quantityBase: z
              .number()
              .int("الكمية لازم تكون رقم صحيح")
              .positive("الكمية لازم تكون أكبر من صفر")
              .max(100_000_000, "الكمية كبيرة قوي"),
          })
          .strict(),
      )
      .max(100, "أصناف كتير قوي في تسجيل واحد")
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
      v.cashPiasters +
        v.parts.reduce((s, p) => s + p.amountPiasters, 0) +
        v.credits.reduce((s, c) => s + c.amountPiasters, 0) >
      0,
    { message: "اكتب مبيعات اليوم", path: ["cashPiasters"] },
  )
  .refine(
    (v) =>
      new Set(v.credits.map((c) => c.customerId)).size === v.credits.length,
    { message: "الزبون الواحد مرة واحدة", path: ["credits"] },
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.variantId)).size === v.items.length,
    { message: "الصنف الواحد مرة واحدة", path: ["items"] },
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
  /** Sold on credit: revenue and customer debts, not cash. */
  creditPiasters: number;
  credits: Array<{
    customerId: string;
    customerName: string;
    amountPiasters: number;
  }>;
  /** Quantities recorded with the total (stock out, no extra revenue). */
  items: Array<{
    variantId: string;
    productName: string;
    quantityBase: number;
    costPiasters: number | null;
  }>;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
}
