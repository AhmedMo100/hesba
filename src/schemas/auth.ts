import { OPERATING_MODES } from "@/domain/operating-mode";
import { z } from "zod";
import { MAX_PERSON_NAME_LENGTH } from "@/domain/limits";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  isCommonPassword,
} from "@/domain";

/**
 * Shared password policy schema for new accounts and password resets.
 * Enforces 12-128 characters, at least one letter, at least one number,
 * permits passphrases, spaces, and symbols without silent trimming,
 * and rejects common or easily guessed passwords.
 */
export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "كلمة السر يجب أن تكون 12 حرف على الأقل")
  .max(PASSWORD_MAX_LENGTH, "كلمة السر لا يجب أن تتجاوز 128 حرف")
  .refine((val) => /\p{L}/u.test(val), {
    message: "كلمة السر يجب أن تحتوي على حرف واحد على الأقل",
  })
  .refine((val) => /[0-9\u0660-\u0669]/.test(val), {
    message: "كلمة السر يجب أن تحتوي على رقم واحد على الأقل",
  })
  .refine((val) => !isCommonPassword(val), {
    message: "كلمة السر شائعة وسهلة التخمين، اختار كلمة سر أقوى أو جملة سرية",
  });

/** Owner name (QA-58): required, at most MAX_PERSON_NAME_LENGTH characters, never truncated. */
const ownerNameSchema = (required: string) =>
  z
    .string()
    .trim()
    .min(2, required)
    .max(
      MAX_PERSON_NAME_LENGTH,
      `الاسم طويل قوي (أقصى حاجة ${MAX_PERSON_NAME_LENGTH} حرف)`,
    );

/**
 * An optional e-mail (sign-up and the profile): empty or missing = no e-mail (stored as NULL);
 * anything typed must be a valid address, stored trimmed and lower-cased.
 */
const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "بريد إلكتروني غير صحيح")
  .refine((v) => v === "" || z.string().email().safeParse(v).success, {
    message: "بريد إلكتروني غير صحيح",
  })
  .optional()
  .nullable()
  .transform((v) => (v ? v : undefined));

export const signupInputSchema = z.object({
  ownerName: ownerNameSchema("اسم صاحب المحل مطلوب"),
  phone: z
    .string()
    .trim()
    .regex(/^(01[0125]\d{8}|\+201[0125]\d{8})$/, "رقم هاتف مصري غير صحيح"),
  email: optionalEmailSchema,
  password: passwordPolicySchema,
  storeName: z.string().trim().min(2, "اسم المحل مطلوب"),
  shopType: z.string().trim().min(2, "نوع المحل مطلوب"),
  governorate: z.string().trim().min(2, "المحافظة مطلوبة"),
  area: z.string().trim().optional(),
  openedOn: z.string().trim().optional(),
  workersCount: z.coerce
    .number()
    .int()
    .min(1, "عدد العاملين 1 على الأقل")
    .optional()
    .default(1),
  withDemoData: z.boolean().optional().default(false),
  /**
   * Hesba has ONE package (2026-11-23, owner's decision): every shop works as الكاشير الذكي.
   * The field is accepted (an older app may still send it) and ignored — the server always
   * creates the shop in 'pos' (ADR-0035).
   */
  operatingMode: z.enum(OPERATING_MODES).optional(),
  /**
   * Optional referral (influencer) code, e.g. `mogamal123`. Empty = none. Matched without
   * case; checked against `referral_codes` on the server (an unknown code is a 400).
   */
  referralCode: z
    .string()
    .trim()
    .toLowerCase()
    .max(32, "كود الدعوة غير صحيح")
    .regex(/^([a-z0-9_-]{3,32})?$/, "كود الدعوة غير صحيح")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export type SignupInput = z.input<typeof signupInputSchema>;

export const loginInputSchema = z.object({
  identifier: z.string().trim().min(1, "رقم الموبايل أو الإيميل مطلوب"),
  password: z.string().min(1, "كلمة السر مطلوبة"),
});

export type LoginInput = z.input<typeof loginInputSchema>;

/**
 * Changing the account's password while signed in — the forced change after an admin reset, or
 * a normal change. The current (or temporary) password is always required: a stolen session
 * alone cannot take over the account.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "اكتب كلمة المرور الحالية"),
    newPassword: passwordPolicySchema,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "اختار كلمة مرور جديدة غير الحالية",
  });

export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const storeProfileUpdateSchema = z.object({
  ownerName: ownerNameSchema("اسم المالك مطلوب"),
  phone: z
    .string()
    .trim()
    .regex(/^(01[0125]\d{8}|\+201[0125]\d{8})$/, "رقم هاتف مصري غير صحيح"),
  email: optionalEmailSchema,
  storeName: z.string().trim().min(2, "اسم المحل مطلوب"),
  shopType: z.string().trim().min(2, "نوع المحل مطلوب"),
  governorate: z.string().trim().min(2, "المحافظة مطلوبة"),
  area: z.string().trim().optional(),
  openedOn: z.string().trim().optional(),
  workersCount: z.coerce.number().int().min(1, "عدد العاملين 1 على الأقل"),
});

export type StoreProfileUpdateInput = z.infer<typeof storeProfileUpdateSchema>;
