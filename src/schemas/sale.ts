import { z } from "zod";
import { MAX_SALE_QUANTITY_BASE } from "@/domain/sale-pricing";

/**
 * Body of `POST /api/sales` (ADR-0019). The server owns the sale: it resolves the product,
 * prices it, checks and deducts stock, and records everything in one transaction.
 *
 * - Ordinary product: `variantId` (or `productId`) + `quantityBase`. The client's
 *   `amountPiasters` is ignored; the total comes from the product's selling price.
 * - Sandwich: `productId` of the sandwich + `quantityBase` = how many (ADR-0018).
 * - Promotion: `promotionId`; the price and items come from the offer the shop saved.
 * - Service (top-up, bill, card): `productId` (or `name` for a service not yet in the shop)
 *   + `amountPiasters` = what the customer paid, because the amount varies per transaction.
 *   With `machineId` + `machineDeductPiasters`, the POS machine is charged in the same
 *   transaction (ADR-0020).
 *
 * `opId` makes the request idempotent: sending the same `opId` again returns the first sale.
 * `timestamp` is accepted for older clients but ignored: the sale time is the server's.
 */
export const createSaleSchema = z.object({
  id: z.string().optional(),
  opId: z.string().uuid().optional(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  promotionId: z.string().min(1).optional(),
  name: z.string().trim().optional(),
  quantityBase: z
    .number()
    .int()
    .positive()
    .max(MAX_SALE_QUANTITY_BASE, "الكمية كبيرة قوي")
    .default(1),
  amountPiasters: z.number().int().min(0).optional(),
  label: z.string().optional(),
  isCarton: z.boolean().optional(),
  commissionPiasters: z.number().int().min(0).optional(),
  machineId: z.string().optional().nullable(),
  /** Services paid through a POS machine: charged in the sale transaction (ADR-0020). */
  machineDeductPiasters: z
    .number()
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .min(0)
    .max(1_000_000_000, "المبلغ كبير قوي")
    .optional()
    .nullable(),
  machineName: z.string().optional().nullable(),
  timestamp: z.number().optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

/** One line of a recorded sale, as returned by `POST /api/sales`. */
export interface RecordedSaleLine {
  productId: string | null;
  variantId: string | null;
  quantityBase: number;
  totalPiasters: number;
  /** The variant's stock balance after this sale; null for lines that hold no stock. */
  stockAfterBase: number | null;
}

/** Result of `POST /api/sales`: the sale as the server recorded it. */
export interface RecordedSale {
  id: string;
  totalPiasters: number;
  /** True when this `opId` was already recorded and the first sale is returned. */
  duplicate: boolean;
  lines: RecordedSaleLine[];
  /** Service sales paid through a POS machine: the machine's balance after the charge. */
  machine?: { machineId: string; balanceAfterPiasters: number };
}
