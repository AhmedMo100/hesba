import { z } from "zod";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

const piasters = (message: string) =>
  z
    .number({ message })
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .positive("المبلغ لازم يكون أكبر من صفر")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي");

/** The drawer ("cash") or one of the shop's machines / wallets. */
const accountSchema = z.union([
  z.literal("cash"),
  z.object({ machineId: z.string().uuid("الحساب غير صحيح") }).strict(),
]);
export type MoneyAccountRef = z.infer<typeof accountSchema>;

const sameAccount = (a?: MoneyAccountRef, b?: MoneyAccountRef) =>
  !!a &&
  !!b &&
  (a === "cash" ? b === "cash" : b !== "cash" && a.machineId === b.machineId);

/** `POST /api/money/movements`: an owner withdrawal / deposit, or a transfer. */
export const moneyMovementSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    kind: z.enum(["owner_withdrawal", "owner_deposit", "transfer"], {
      message: "اختار نوع الحركة",
    }),
    amountPiasters: piasters("المبلغ غير صحيح"),
    from: accountSchema.optional(),
    to: accountSchema.optional(),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: "from" | "to", message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (v.kind === "owner_withdrawal") {
      need(!!v.from, "from", "اختار الفلوس هتتسحب منين");
      need(!v.to, "to", "السحب الشخصي مالوش حساب يروح له");
    } else if (v.kind === "owner_deposit") {
      need(!!v.to, "to", "اختار الفلوس هتدخل فين");
      need(!v.from, "from", "الإيداع مالوش حساب يطلع منه");
      // The drawer is never charged by hand (its money comes from cash operations).
      need(
        v.to !== "cash",
        "to",
        "الدرج مبيتشحنش بإيدك: فلوسه بتيجي من البيع والعمليات الكاش. حط الفلوس في ماكينة أو محفظة.",
      );
    } else {
      need(!!v.from, "from", "اختار التحويل من فين");
      need(!!v.to, "to", "اختار التحويل لفين");
      if (sameAccount(v.from, v.to)) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "التحويل لازم يكون بين حسابين مختلفين",
        });
      }
    }
  });
export type MoneyMovementInput = z.infer<typeof moneyMovementSchema>;

/**
 * `POST /api/services/transactions`: a service the owner already performed, for one of the
 * shop's service products — the same service the cashier sells, with the same single
 * commission rule (ADR-0035).
 */
export const serviceTransactionSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    /** The shop's service product (its name, category and commission rule). */
    serviceProductId: z.string().uuid("اختار الخدمة"),
    /** send: the customer pays, the float sends it out; receive: the float gets it, the shop pays out. */
    direction: z.enum(["send", "receive"], { message: "اختار نوع العملية" }),
    amountPiasters: piasters("مبلغ العملية غير صحيح"),
    /** The provider float the operation used (a machine / wallet of the shop). */
    floatMachineId: z.string().uuid("اختار رصيد الخدمة"),
    /** Where the customer's money went / came from. */
    payment: accountSchema.default("cash"),
    /** Typed by the owner when it differs from the rule (kept as typed). */
    commissionPiasters: z
      .number()
      .int("العمولة لازم تكون بالقروش")
      .min(0, "العمولة مينفعش تبقى سالبة")
      .max(MAX_AMOUNT_PIASTERS)
      .optional(),
    reference: z.string().trim().max(100).optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .strict()
  .refine(
    (v) => v.payment === "cash" || v.payment.machineId !== v.floatMachineId,
    {
      message: "فلوس الزبون لازم تروح لحساب غير رصيد الخدمة",
      path: ["payment"],
    },
  );
export type ServiceTransactionInput = z.infer<typeof serviceTransactionSchema>;

export const cancelServiceSchema = z
  .object({ reason: z.string().trim().max(200).optional().nullable() })
  .strict();

// ── «فلوس حِسبة» answers (shared by the server and the screen) ──

export interface MoneyMovementView {
  id: string;
  kind: MoneyMovementInput["kind"];
  label: string;
  amountPiasters: number;
  from: string | null;
  to: string | null;
  note: string | null;
  at: string;
}

export interface MoneyAccountView {
  /** "cash" or a machine id. */
  id: string;
  kind: "cash" | "machine";
  name: string;
  provider: string | null;
  /** The drawer's is computed from the shop's cash operations; it may be negative when more cash
   *  went out than the shop recorded coming in. */
  balancePiasters: number | null;
}

export interface MoneyOverview {
  accounts: MoneyAccountView[];
  /** Sum of the balances. `cashKnown` is always true (kept for older clients). */
  totalPiasters: number;
  cashKnown: boolean;
  movements: MoneyMovementView[];
  /** Recent movements of the machines / wallets (sales, services, top-ups, transfers…). */
  machineActivity: Array<{
    id: string;
    machine: string;
    amountPiasters: number;
    balanceAfterPiasters: number;
    source: string | null;
    at: string;
  }>;
}
