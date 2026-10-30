import { z } from "zod";
import { normalizeNumberString, parseEgpToPiasters } from "@/domain/money";

export const PEOPLE_SECTIONS = ["owedToMe", "iOwe", "suppliers"] as const;
export type PeopleSection = (typeof PEOPLE_SECTIONS)[number];

export const CONTACT_KINDS = ["customer", "supplier", "both"] as const;
export type ContactKindEnum = (typeof CONTACT_KINDS)[number];

export const DEBT_DIRECTIONS = ["owed_to_me", "i_owe"] as const;
export type DebtDirectionEnum = (typeof DEBT_DIRECTIONS)[number];

export const phoneSchema = z
  .string()
  .trim()
  .transform((val) => val.replace(/[\s-]/g, ""))
  .refine(
    (val) =>
      val === "" ||
      /^(\+?20|0)?1[0125]\d{8}$/.test(val) ||
      /^[\d+]{7,15}$/.test(val),
    { message: "رقم تليفون غير صحيح" },
  )
  .optional()
  .nullable();

export const moneyAmountSchema = z
  .union([z.number(), z.string()])
  .transform((val, ctx) => {
    if (typeof val === "number") {
      if (!Number.isFinite(val) || val < 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "المبلغ لا يمكن أن يكون سالباً",
        });
        return z.NEVER;
      }
      return Math.round(val);
    }
    const clean = normalizeNumberString(val);
    if (!clean) return 0;
    if (clean.includes(".")) {
      return parseEgpToPiasters(clean);
    }
    const num = Number(clean);
    if (isNaN(num) || num < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "المبلغ غير صحيح",
      });
      return z.NEVER;
    }
    return Math.round(num);
  });

export const positiveMoneyAmountSchema = z
  .union([z.number(), z.string()])
  .transform((val, ctx) => {
    if (typeof val === "number") {
      if (!Number.isFinite(val) || val <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "المبلغ لازم يكون أكبر من صفر",
        });
        return z.NEVER;
      }
      return Math.round(val);
    }
    const clean = normalizeNumberString(val);
    if (!clean) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "المبلغ مطلوب",
      });
      return z.NEVER;
    }
    if (clean.includes(".")) {
      const piasters = parseEgpToPiasters(clean);
      if (piasters <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "المبلغ لازم يكون أكبر من صفر",
        });
        return z.NEVER;
      }
      return piasters;
    }
    const num = Number(clean);
    if (isNaN(num) || num <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "المبلغ لازم يكون أكبر من صفر",
      });
      return z.NEVER;
    }
    return Math.round(num);
  });

export const createPersonInputSchema = z.object({
  name: z.string().trim().min(1, "اكتب الاسم").max(120, "الاسم طويل جداً"),
  phone: phoneSchema,
  section: z.enum(PEOPLE_SECTIONS, {
    message: "القسم غير صحيح (owedToMe, iOwe, suppliers)",
  }),
  amountPiasters: moneyAmountSchema.default(0),
  note: z.string().trim().max(500, "الملاحظة طويلة جداً").optional().nullable(),
  supplies: z
    .array(z.string().uuid("معرف المنتج غير صحيح"))
    .optional()
    .default([]),
});

export const updatePersonInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "اكتب الاسم")
    .max(120, "الاسم طويل جداً")
    .optional(),
  phone: phoneSchema,
  supplies: z.array(z.string().uuid()).optional(),
  amountPiasters: moneyAmountSchema.optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const recordDebtTransactionInputSchema = z.object({
  type: z.enum(["debt", "payment"], {
    message: "نوع المعاملة يجب أن يكون إما debt أو payment",
  }),
  amountPiasters: positiveMoneyAmountSchema,
  note: z.string().trim().max(500, "الملاحظة طويلة جداً").optional().nullable(),
  opId: z.string().uuid().optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;
export type RecordDebtTransactionInput = z.infer<
  typeof recordDebtTransactionInputSchema
>;
