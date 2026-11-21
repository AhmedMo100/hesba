import { z } from "zod";
import { paidFromSchema } from "./drawer";
import { businessDateSchema } from "./dates";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

/** V19 «صرفت على إيه؟»: the categories the screen offers, in V19's order. */
export const EXPENSE_CATEGORIES = [
  "كهرباء",
  "إيجار",
  "نقل",
  "مرتبات",
  "صيانة",
  "ميه وغاز",
  "إنترنت وموبايل",
  "ضرايب ورسوم",
  "مصاريف شخصية",
  "حاجة تانية",
] as const;

/** Categories saved before V19's list; still valid so older expenses keep their name. */
export const LEGACY_EXPENSE_CATEGORIES = ["إنترنت", "أخرى"] as const;

export type ExpenseCategory =
  | (typeof EXPENSE_CATEGORIES)[number]
  | (typeof LEGACY_EXPENSE_CATEGORIES)[number];

const ALL_EXPENSE_CATEGORIES: readonly string[] = [
  ...EXPENSE_CATEGORIES,
  ...LEGACY_EXPENSE_CATEGORIES,
];

// Accept either Arabic canonical names or common aliases
export const expenseCategorySchema = z.string().transform((val, ctx) => {
  const normalized = val.trim();
  if (normalized === "نت") return "إنترنت";
  if (ALL_EXPENSE_CATEGORIES.includes(normalized)) {
    return normalized as ExpenseCategory;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "تصنيف المصروف غير معروف",
  });
  return z.NEVER;
});

export const createExpenseInputSchema = z
  .object({
    category: expenseCategorySchema,
    amountPiasters: z
      .number()
      .int("المبلغ يجب أن يكون بالقروش (رقم صحيح)")
      .positive("المبلغ لازم يكون أكبر من صفر")
      .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي"),
    note: z
      .string()
      .trim()
      .max(500, "الملاحظة طويلة جداً")
      .optional()
      .nullable(),
    /** A real date, not before 2000 and not in the future (QA-37). */
    spentAt: businessDateSchema.optional(),
    /** Idempotency key (QA-27): a retry with the same opId records the expense once. */
    opId: z.string().uuid().optional(),
    /** The drawer (`cash`) or a wallet (ADR-0031); absent = not recorded. */
    paidFrom: paidFromSchema.optional(),
    /** The shop's machine / wallet that paid it: its balance goes down with the expense. */
    paidFromMachineId: z.string().uuid("اختار المحفظة أو الماكينة").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.paidFromMachineId && v.paidFrom === "cash") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paidFrom"],
        message: "اختار كاش أو محفظة، مش الاتنين",
      });
    }
    if (v.paidFrom === "wallet" && !v.paidFromMachineId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paidFromMachineId"],
        message: "اختار المحفظة أو الماكينة اللي دفعت منها",
      });
    }
  });

export const updateExpenseInputSchema = z.object({
  category: expenseCategorySchema.optional(),
  amountPiasters: z
    .number()
    .int("المبلغ يجب أن يكون بالقروش")
    .positive("المبلغ لازم يكون أكبر من صفر")
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي")
    .optional(),
  note: z.string().trim().max(500).optional().nullable(),
  /** A real date, not before 2000 and not in the future (QA-37). */
  spentAt: businessDateSchema.optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseInputSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseInputSchema>;

export const EXPENSE_PERIODS = [
  "today",
  "yesterday",
  "7days",
  "month",
  "year",
  "custom",
] as const;

export type ExpensePeriod = (typeof EXPENSE_PERIODS)[number];
