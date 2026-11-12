import { z } from "zod";
import { expiryDateSchema } from "./dates";
import { MAX_AMOUNT_PIASTERS, MAX_QUANTITY_BASE } from "@/domain/limits";

/**
 * Supplier purchases (QA-30, ADR-0027). Money is integer piasters, quantities integer base
 * units (pieces or grams). The server computes the invoice total from the lines and stamps
 * the time; the client never sends a total or a date.
 */

const piasters = (message: string) =>
  z
    .number({ message })
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي");

/** Body of `POST /api/purchases`: one supplier invoice, received into stock. */
export const createPurchaseSchema = z
  .object({
    /** Idempotency key: the same opId records the purchase once. */
    opId: z.string().uuid("رقم العملية غير صحيح"),
    supplierId: z.string().uuid("المورد غير صحيح"),
    lines: z
      .array(
        z.object({
          storeVariantId: z.string().uuid("الصنف غير صحيح"),
          quantityBase: z
            .number()
            .int("الكمية لازم تكون رقم صحيح")
            .positive("الكمية لازم تكون أكبر من صفر")
            .max(MAX_QUANTITY_BASE, "الكمية كبيرة قوي"),
          /** What the whole line cost on the supplier's invoice. */
          totalCostPiasters: piasters("تكلفة الصنف غير صحيحة").min(
            0,
            "التكلفة مينفعش تبقى سالبة",
          ),
          expiryDate: expiryDateSchema.optional().nullable(),
        }),
      )
      .min(1, "الفاتورة لازم يكون فيها صنف واحد على الأقل")
      .max(50, "أصناف الفاتورة كتير قوي"),
    /** Paid to the supplier now (part or all); the rest stays «عليك». */
    paidNowPiasters: piasters("المدفوع غير صحيح")
      .min(0, "المدفوع مينفعش يبقى سالب")
      .default(0),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

/** Body of `POST /api/purchases/:id/payments`. */
export const purchasePaymentSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    amountPiasters: piasters("المبلغ غير صحيح").positive(
      "المبلغ لازم يكون أكبر من صفر",
    ),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export type PurchasePaymentInput = z.infer<typeof purchasePaymentSchema>;

/** Body of `POST /api/purchases/:id/void`. */
export const voidPurchaseSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    reason: z.string().trim().max(500).optional().nullable(),
  })
  .strict();

export type VoidPurchaseInput = z.infer<typeof voidPurchaseSchema>;

/** One purchase as the API returns it. */
export interface PurchaseView {
  id: string;
  supplierId: string | null;
  supplierName: string | null;
  totalPiasters: number;
  paidPiasters: number;
  /** What is still owed on this invoice (0 when cancelled; < 0 never shown as owed). */
  outstandingPiasters: number;
  voided: boolean;
  voidedAt: string | null;
  note: string | null;
  createdAt: string;
  duplicate?: boolean;
  lines: Array<{
    id: string;
    storeVariantId: string | null;
    productName: string | null;
    quantityBase: number;
    totalCostPiasters: number;
    expiryDate: string | null;
    batchId: string | null;
  }>;
}
