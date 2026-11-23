import { z } from "zod";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";
import {
  commissionRuleErrors,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import { SERVICE_BY_KEY } from "@/domain/services-catalog";

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

/** `POST /api/services/transactions`: a service the owner already performed. */
export const serviceTransactionSchema = z
  .object({
    opId: z.string().uuid("رقم العملية غير صحيح"),
    serviceKey: z
      .string()
      .refine((k) => SERVICE_BY_KEY.has(k), { message: "اختار الخدمة" }),
    provider: z.string().trim().min(1, "اكتب اسم الشركة").max(60),
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

const ruleSchema = z
  .object({
    type: z.enum(["fixed", "percent"]),
    value: z.number().min(0),
    tiers: z
      .array(
        z
          .object({
            fromPiasters: z.number().int().min(0),
            toPiasters: z.number().int().min(1),
            type: z.enum(["fixed", "percent"]),
            value: z.number().min(0),
          })
          .strict(),
      )
      .max(20, "الشرائح كتير قوي")
      .default([]),
  })
  .strict()
  .superRefine((rule, ctx) => {
    for (const message of commissionRuleErrors(rule as ServiceCommissionRule)) {
      ctx.addIssue({ code: "custom", message });
    }
  });

/** `PUT /api/services/rules`: the shop's commission rule per service (null removes it). */
export const serviceRulesSchema = z
  .object({
    rules: z.record(
      z.string().refine((k) => SERVICE_BY_KEY.has(k), "خدمة غير معروفة"),
      z
        .object({
          mode: z.enum(["customer_fee", "provider_discount"]),
          rule: ruleSchema,
        })
        .strict()
        .nullable(),
    ),
  })
  .strict();
export type ServiceRulesInput = z.infer<typeof serviceRulesSchema>;

export const cancelServiceSchema = z
  .object({ reason: z.string().trim().max(200).optional().nullable() })
  .strict();
