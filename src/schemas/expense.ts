import { z } from "zod";

export const EXPENSE_CATEGORIES = [
  "كهرباء",
  "إنترنت",
  "إيجار",
  "مرتبات",
  "نقل",
  "صيانة",
  "أخرى",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// Accept either Arabic canonical names or common aliases
export const expenseCategorySchema = z.string().transform((val, ctx) => {
  const normalized = val.trim();
  if (normalized === "نت") return "إنترنت";
  if ((EXPENSE_CATEGORIES as readonly string[]).includes(normalized)) {
    return normalized as ExpenseCategory;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "تصنيف المصروف غير معروف",
  });
  return z.NEVER;
});

export const createExpenseInputSchema = z.object({
  category: expenseCategorySchema,
  amountPiasters: z
    .number()
    .int("المبلغ يجب أن يكون بالقروش (رقم صحيح)")
    .positive("المبلغ لازم يكون أكبر من صفر"),
  note: z.string().trim().max(500, "الملاحظة طويلة جداً").optional().nullable(),
  spentAt: z
    .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}/)])
    .optional(),
});

export const updateExpenseInputSchema = z.object({
  category: expenseCategorySchema.optional(),
  amountPiasters: z
    .number()
    .int("المبلغ يجب أن يكون بالقروش")
    .positive("المبلغ لازم يكون أكبر من صفر")
    .optional(),
  note: z.string().trim().max(500).optional().nullable(),
  spentAt: z
    .union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}/)])
    .optional(),
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
