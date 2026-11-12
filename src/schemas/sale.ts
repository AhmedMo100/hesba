import { z } from "zod";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";
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
/**
 * How the customer paid (QA-31). `debt` (آجل) needs a customer and goes through checkout
 * (`POST /api/sales/checkout`), which also writes the receivable.
 */
export const PAYMENT_METHODS = ["cash", "wallet", "card", "debt"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
/** Methods paid on the spot (no receivable). */
export const INSTANT_PAYMENT_METHODS = ["cash", "wallet", "card"] as const;
export type InstantPaymentMethod = (typeof INSTANT_PAYMENT_METHODS)[number];

export const createSaleSchema = z.object({
  /** Ignored: the server chooses the sale id (QA-56). Kept for older clients. */
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
  amountPiasters: z
    .number()
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .min(0)
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي")
    .optional(),
  label: z.string().optional(),
  isCarton: z.boolean().optional(),
  commissionPiasters: z
    .number()
    .int()
    .min(0, "العمولة مينفعش تبقى سالبة")
    .max(MAX_AMOUNT_PIASTERS, "العمولة كبيرة قوي")
    .optional(),
  machineId: z.string().optional().nullable(),
  /** Services paid through a POS machine: charged in the sale transaction (ADR-0020). */
  machineDeductPiasters: z
    .number()
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .min(0)
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي")
    .optional()
    .nullable(),
  machineName: z.string().optional().nullable(),
  timestamp: z.number().optional(),
  /** Paid on the spot by cash, e-wallet or card (default cash). Credit sales use checkout. */
  paymentMethod: z
    .enum(INSTANT_PAYMENT_METHODS, { message: "طريقة الدفع غير صحيحة" })
    .optional(),
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

/**
 * `POST /api/sales/void` (ADR-0022, QA-10): undo a recorded sale with a reversing void.
 * `opId` is the client's id for THIS void: a retry with the same `opId` is applied once.
 */
export const voidSaleSchema = z.object({
  saleId: z.string().uuid("معرّف البيعة غير صحيح"),
  opId: z.string().uuid().optional(),
  reason: z.string().trim().max(200).optional(),
});

export type VoidSaleInput = z.infer<typeof voidSaleSchema>;

/** Result of a void: the sale stays recorded, marked void, and its stock is back. */
export interface VoidedSale {
  saleId: string;
  voidId: string;
  voidedAt: string;
  totalPiasters: number;
  /** True when the sale was already void (nothing was restored a second time). */
  alreadyVoided: boolean;
  /** Each restored variant's stock balance after the void. */
  stock: Array<{ variantId: string; stockAfterBase: number }>;
  /** A service sale paid through a POS machine: the machine's balance after the refund. */
  machine?: { machineId: string; balanceAfterPiasters: number };
}

const salePiasters = (message: string) =>
  z
    .number({ message })
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .min(0, "المبلغ مينفعش يبقى سالب")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي");

/**
 * `POST /api/sales/checkout` (QA-31, ADR-0027): a cart of stocked products sold as ONE
 * invoice. The server prices every line from the registered price, checks and takes the
 * stock (FEFO), applies the discount, and — for a credit sale — writes the receivable, all in
 * one transaction. The client sends no prices and no total.
 */
export const checkoutSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    lines: z
      .array(
        z.object({
          variantId: z.string().uuid("الصنف غير صحيح"),
          quantityBase: z
            .number()
            .int("الكمية لازم تكون رقم صحيح")
            .positive("الكمية لازم تكون أكبر من صفر")
            .max(MAX_SALE_QUANTITY_BASE, "الكمية كبيرة قوي"),
        }),
      )
      .min(1, "السلة فاضية")
      .max(50, "أصناف السلة كتير قوي"),
    /** A discount on the whole invoice, in piasters (below the subtotal). */
    discountPiasters: salePiasters("الخصم غير صحيح").default(0),
    paymentMethod: z.enum(PAYMENT_METHODS, {
      message: "طريقة الدفع غير صحيحة",
    }),
    /** Required for a credit sale (آجل): the customer who owes the invoice. */
    customerId: z.string().uuid("الزبون غير صحيح").optional().nullable(),
    /** Credit sale only: what the customer paid now; the rest stays «ليك». */
    paidNowPiasters: salePiasters("المدفوع غير صحيح").default(0),
  })
  .strict()
  .refine((v) => v.paymentMethod !== "debt" || Boolean(v.customerId), {
    message: "البيع الآجل لازم يكون لزبون",
    path: ["customerId"],
  })
  .refine((v) => v.paymentMethod === "debt" || !v.customerId, {
    message: "الزبون بيتسجل في البيع الآجل بس",
    path: ["customerId"],
  })
  .refine((v) => v.paymentMethod === "debt" || v.paidNowPiasters === 0, {
    message: "المدفوع مقدماً للبيع الآجل بس",
    path: ["paidNowPiasters"],
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** `POST /api/sales/:id/payments`: the customer pays (part of) a credit invoice. */
export const salePaymentSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    amountPiasters: salePiasters("المبلغ غير صحيح").refine(
      (v) => v > 0,
      "المبلغ لازم يكون أكبر من صفر",
    ),
  })
  .strict();

export type SalePaymentInput = z.infer<typeof salePaymentSchema>;

/** `POST /api/sales/:id/returns`: return some or all of a sale's lines. */
export const saleReturnSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    lines: z
      .array(
        z.object({
          saleLineId: z.string().uuid("سطر البيعة غير صحيح"),
          quantityBase: z
            .number()
            .int("الكمية لازم تكون رقم صحيح")
            .positive("الكمية لازم تكون أكبر من صفر")
            .max(MAX_SALE_QUANTITY_BASE, "الكمية كبيرة قوي"),
          /**
           * `sellable` (default): back to stock. `damaged`: recorded as a loss
           * («مرتجع تالف») — the customer is still credited/refunded, stock does not grow.
           */
          condition: z.enum(["sellable", "damaged"]).default("sellable"),
        }),
      )
      .min(1, "اختار صنف ترجّعه")
      .max(50),
    reason: z.string().trim().max(200).optional().nullable(),
  })
  .strict();

export type SaleReturnInput = z.infer<typeof saleReturnSchema>;

/** A sale invoice with what can still be returned and what is still owed (QA-31). */
export interface SaleInvoice {
  id: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  customerId: string | null;
  customerName: string | null;
  subtotalPiasters: number;
  discountPiasters: number;
  totalPiasters: number;
  returnedPiasters: number;
  /** Credit sale: what the customer still owes on this invoice (never < 0). */
  outstandingPiasters: number;
  voided: boolean;
  duplicate?: boolean;
  lines: Array<{
    id: string;
    variantId: string | null;
    name: string;
    unit: string;
    quantityBase: number;
    unitPricePiasters: number;
    discountPiasters: number;
    totalPiasters: number;
    returnedQuantityBase: number;
    /** False for lines that hold no stock (services, sandwiches): not returnable here. */
    returnable: boolean;
  }>;
}

/** A short, human invoice number derived from the sale id (the id stays the reference). */
export function invoiceNumberOf(saleId: string): string {
  return saleId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export type InvoiceStatus = "paid" | "partial" | "unpaid" | "voided";

/**
 * `GET /api/people/:id/invoices` (Prompt 2): a customer's «ليك» explained — every credit
 * invoice with its products, what was paid on it and what it still owes, plus payments that
 * were not tied to one invoice (they settle the oldest debts first).
 */
export interface CustomerInvoicesView {
  customer: { id: string; name: string; phone: string | null };
  /** Signed balance: > 0 the customer owes the shop; < 0 the shop holds their credit. */
  balancePiasters: number;
  outstandingPiasters: number;
  creditPiasters: number;
  /** Debt not from an invoice (opening balance, «سجّل عليه») still unpaid. */
  otherDebtPiasters: number;
  invoices: Array<{
    id: string;
    number: string;
    createdAt: string;
    totalPiasters: number;
    returnedPiasters: number;
    /** Paid on this invoice directly (at the sale or later from the invoice). */
    paidPiasters: number;
    /** Covered by general payments («ليك» without choosing an invoice). */
    settledByGeneralPiasters: number;
    remainingPiasters: number;
    status: InvoiceStatus;
    lines: Array<{
      name: string;
      unit: string;
      quantityBase: number;
      returnedQuantityBase: number;
      unitPricePiasters: number;
      totalPiasters: number;
    }>;
    payments: Array<{
      amountPiasters: number;
      createdAt: string;
      kind: "payment" | "return";
    }>;
  }>;
  generalPayments: Array<{
    amountPiasters: number;
    createdAt: string;
    note: string | null;
  }>;
}
