import { z } from "zod";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";
import {
  commissionRuleErrors,
  type ServiceCommissionRule,
} from "@/domain/service-commission";

/**
 * `POST /api/sales/config` (QA-21): a PARTIAL update of the shop's sales-screen config. Only
 * the lists that are sent change; an omitted list keeps its saved value. Unknown fields, a
 * wrong type, an empty body or a non-object body are a 400 — the saved config is never reset.
 */
const idList = z
  .array(z.string().trim().min(1, "معرّف فاضي").max(100, "معرّف طويل قوي"), {
    message: "القائمة لازم تكون قائمة معرّفات",
  })
  .max(1000, "القائمة طويلة قوي");

const amount = z
  .number({ message: "المبلغ لازم يكون رقم" })
  .int("المبلغ لازم يكون بالقروش")
  .min(0, "المبلغ مينفعش يبقى سالب")
  .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي");
const commissionType = z.enum(["fixed", "percent"], {
  message: "اختار نوع العمولة",
});
const commissionValue = z
  .number({ message: "العمولة لازم تكون رقم" })
  .min(0, "العمولة مينفعش تبقى سالبة")
  .max(MAX_AMOUNT_PIASTERS, "العمولة كبيرة قوي");

/** A service's commission (fixed / percent, with optional amount tiers). */
export const serviceCommissionRuleSchema = z
  .object({
    type: commissionType,
    value: commissionValue,
    tiers: z
      .array(
        z
          .object({
            fromPiasters: amount,
            toPiasters: amount,
            type: commissionType,
            value: commissionValue,
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

export const salesViewConfigUpdateSchema = z
  .object({
    enabledServiceIds: idList.optional(),
    enabledProductIds: idList.optional(),
    /** Per service id: its commission rule (merged; `null` removes it). */
    serviceCommissions: z
      .record(
        z.string().trim().min(1).max(100),
        serviceCommissionRuleSchema.nullable(),
      )
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.enabledServiceIds !== undefined ||
      v.enabledProductIds !== undefined ||
      v.serviceCommissions !== undefined,
    { message: "مفيش حاجة تتحفظ" },
  );

export type SalesViewConfigUpdate = z.infer<typeof salesViewConfigUpdateSchema>;
