import { z } from "zod";

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

export const createPersonInputSchema = z.object({
  name: z.string().trim().min(1, "اكتب الاسم").max(120, "الاسم طويل جداً"),
  phone: phoneSchema,
  section: z.enum(PEOPLE_SECTIONS, {
    message: "القسم غير صحيح (owedToMe, iOwe, suppliers)",
  }),
  amountPiasters: z
    .number()
    .int("المبلغ يجب أن يكون بالقروش (رقم صحيح)")
    .min(0, "المبلغ لا يمكن أن يكون سالباً")
    .default(0),
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
  amountPiasters: z
    .number()
    .int("المبلغ يجب أن يكون بالقروش")
    .min(0, "المبلغ لا يمكن أن يكون سالباً")
    .optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

export const recordDebtTransactionInputSchema = z.object({
  type: z.enum(["debt", "payment"], {
    message: "نوع المعاملة يجب أن يكون إما debt أو payment",
  }),
  amountPiasters: z
    .number()
    .int("المبلغ يجب أن يكون بالقروش (رقم صحيح)")
    .positive("المبلغ لازم يكون أكبر من صفر"),
  note: z.string().trim().max(500, "الملاحظة طويلة جداً").optional().nullable(),
  opId: z.string().uuid().optional(),
});

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;
export type RecordDebtTransactionInput = z.infer<
  typeof recordDebtTransactionInputSchema
>;
