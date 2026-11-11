import { z } from "zod";
import { normalizeNumberString, parseEgpStrict } from "@/domain/money";
import { MAX_AMOUNT_PIASTERS } from "@/domain/limits";

export const PEOPLE_SECTIONS = ["owedToMe", "iOwe", "suppliers"] as const;
export type PeopleSection = (typeof PEOPLE_SECTIONS)[number];

export const CONTACT_KINDS = ["customer", "supplier", "both"] as const;
export type ContactKindEnum = (typeof CONTACT_KINDS)[number];

export const DEBT_DIRECTIONS = ["owed_to_me", "i_owe"] as const;
export type DebtDirectionEnum = (typeof DEBT_DIRECTIONS)[number];

export const phoneSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((val) => {
    if (!val) return null;
    const clean = normalizeNumberString(val).replace(/[\s-]/g, "");
    return clean === "" ? null : clean;
  })
  .refine(
    (val) =>
      val === null ||
      /^(\+?20|0)?1[0125]\d{8}$/.test(val) ||
      /^[\d+]{7,15}$/.test(val),
    { message: "رقم تليفون غير صحيح" },
  );

/**
 * Money on the People API (QA-22) — one unit per field, no guessing:
 * - `amountPiasters` / `amount_piasters`: integer piasters as a JSON number. A string, a
 *   fraction, a negative or an out-of-range value is a 400 (never silently converted).
 * - `amountEgp`: pounds, as a number or a string with at most 2 decimals (`50`, `"50"`,
 *   `"50.00"`, `"٥٠"` → 50.00 EGP), converted exactly (`parseEgpStrict`).
 * Send one of them, not both.
 */
const piastersField = (min: 0 | 1) =>
  z
    .number({ message: "المبلغ لازم يكون رقم بالقروش (مش نص)" })
    .int("المبلغ لازم يكون بالقروش (رقم صحيح)")
    .min(
      min,
      min === 1
        ? "المبلغ لازم يكون أكبر من صفر"
        : "المبلغ لا يمكن أن يكون سالباً",
    )
    .max(MAX_AMOUNT_PIASTERS, "المبلغ كبير قوي");

const egpField = (min: 0 | 1) =>
  z.union([z.number(), z.string()]).transform((val, ctx) => {
    const piasters = parseEgpStrict(val);
    if (piasters === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "المبلغ بالجنيه غير صحيح (رقم موجب وبحد أقصى قرشين بعد العلامة)",
      });
      return z.NEVER;
    }
    if (piasters < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "المبلغ لازم يكون أكبر من صفر",
      });
      return z.NEVER;
    }
    if (piasters > MAX_AMOUNT_PIASTERS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "المبلغ كبير قوي" });
      return z.NEVER;
    }
    return piasters;
  });

/** The one amount of a request, from whichever single field was sent (or undefined). */
function pickAmount(
  data: {
    amountPiasters?: number;
    amount_piasters?: number;
    amountEgp?: number;
  },
  ctx: z.RefinementCtx,
): number | undefined {
  const given = [
    data.amountPiasters,
    data.amount_piasters,
    data.amountEgp,
  ].filter((v) => v !== undefined);
  if (given.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ابعت المبلغ مرة واحدة بس (amountPiasters أو amountEgp)",
    });
    return undefined;
  }
  return given[0];
}

export const createPersonInputSchema = z
  .object({
    name: z.string().trim().min(1, "اكتب الاسم").max(120, "الاسم طويل جداً"),
    phone: phoneSchema.optional(),
    section: z.enum(PEOPLE_SECTIONS, {
      message: "القسم غير صحيح (owedToMe, iOwe, suppliers)",
    }),
    amountPiasters: piastersField(0).optional(),
    amount_piasters: piastersField(0).optional(),
    amountEgp: egpField(0).optional(),
    note: z
      .string()
      .trim()
      .max(500, "الملاحظة طويلة جداً")
      .optional()
      .nullable(),
    supplies: z.array(z.string().min(1)).optional().default([]),
  })
  .transform((data, ctx) => ({
    name: data.name,
    phone: data.phone ?? null,
    section: data.section,
    amountPiasters: pickAmount(data, ctx) ?? 0,
    note: data.note ?? null,
    supplies: data.supplies,
  }));

export const updatePersonInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "اكتب الاسم")
      .max(120, "الاسم طويل جداً")
      .optional(),
    phone: phoneSchema.optional(),
    supplies: z.array(z.string().min(1)).optional(),
    amountPiasters: piastersField(0).optional(),
    amount_piasters: piastersField(0).optional(),
    amountEgp: egpField(0).optional(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .transform((data, ctx) => ({
    name: data.name,
    phone: data.phone,
    supplies: data.supplies,
    amountPiasters: pickAmount(data, ctx),
    note: data.note ?? null,
  }));

export const recordDebtTransactionInputSchema = z
  .object({
    type: z.enum(["debt", "payment"], {
      message: "نوع المعاملة يجب أن يكون إما debt أو payment",
    }),
    amountPiasters: piastersField(1).optional(),
    amount_piasters: piastersField(1).optional(),
    amountEgp: egpField(1).optional(),
    note: z
      .string()
      .trim()
      .max(500, "الملاحظة طويلة جداً")
      .optional()
      .nullable(),
    date: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable(),
    created_at: z.string().optional().nullable(),
    opId: z.string().uuid().optional(),
    op_id: z.string().uuid().optional(),
  })
  .transform((data, ctx) => {
    const amount = pickAmount(data, ctx);
    if (amount === undefined || amount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "المبلغ لازم يكون أكبر من صفر",
      });
      return z.NEVER;
    }
    const rawDate = data.date || data.createdAt || data.created_at;
    let parsedDate: Date | undefined;
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        parsedDate = d;
      }
    }

    return {
      type: data.type,
      amountPiasters: amount,
      note: data.note ?? null,
      date: parsedDate,
      opId: data.op_id || data.opId,
    };
  });

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;
export type RecordDebtTransactionInput = z.infer<
  typeof recordDebtTransactionInputSchema
>;
