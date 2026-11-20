import { z } from "zod";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

/**
 * The cash drawer (ADR-0031). `paid_from` says whether a money movement went through the
 * drawer (`cash`) or a wallet / machine (`wallet`); unrecorded movements are never counted.
 */
export const PAID_FROM = ["cash", "wallet"] as const;
export type PaidFrom = (typeof PAID_FROM)[number];
export const paidFromSchema = z.enum(PAID_FROM, {
  message: "اختار الفلوس اتدفعت منين",
});

/** Body of `POST /api/drawer`: the owner counted the drawer. */
export const drawerCountSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    countedPiasters: z
      .number({ message: "اكتب المبلغ اللي عدّيته" })
      .int("المبلغ لازم يكون بالقروش")
      .min(0, "المبلغ مينفعش يبقى سالب")
      .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي"),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export type DrawerCountInput = z.infer<typeof drawerCountSchema>;

/** One line of what moved the drawer since the last count. */
export interface DrawerFlow {
  key:
    | "cashSales"
    | "collections"
    | "expenseCancels"
    | "refunds"
    | "voids"
    | "expenses"
    | "supplierPayments"
    | "stockPurchases"
    | "machineTopups";
  direction: "in" | "out";
  count: number;
  amountPiasters: number;
}

/** `GET /api/drawer`. Money is piasters; `expectedPiasters` is null before the first count. */
export interface DrawerView {
  lastCount: {
    countedPiasters: number;
    expectedPiasters: number | null;
    countedAt: string;
  } | null;
  expectedPiasters: number | null;
  inPiasters: number;
  outPiasters: number;
  flows: DrawerFlow[];
  /** Movements since the last count whose source (drawer or wallet) was not recorded. */
  unknown: { count: number; amountPiasters: number };
  recentCounts: Array<{
    countedPiasters: number;
    expectedPiasters: number | null;
    countedAt: string;
  }>;
}
