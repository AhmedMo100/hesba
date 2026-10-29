import { z } from "zod";
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

export const signupInputSchema = z.object({
  ownerName: z.string().trim().min(2, "اسم صاحب المحل مطلوب"),
  phone: z
    .string()
    .trim()
    .regex(/^(01[0125]\d{8}|\+201[0125]\d{8})$/, "رقم هاتف مصري غير صحيح"),
  email: z
    .string()
    .trim()
    .min(1, "البريد الإلكتروني مطلوب")
    .email("بريد إلكتروني غير صحيح"),
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
});

export type SignupInput = z.input<typeof signupInputSchema>;

export const loginInputSchema = z.object({
  phone: z.string().trim().min(10, "رقم الموبايل مطلوب"),
  password: z.string().min(1, "كلمة السر مطلوبة"),
});

export type LoginInput = z.input<typeof loginInputSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: z.string().trim().email("بريد إلكتروني غير صحيح"),
});

export type ForgotPasswordRequestInput = z.input<
  typeof forgotPasswordRequestSchema
>;

export const resetPasswordWithCodeSchema = z.object({
  email: z.string().trim().email("بريد إلكتروني غير صحيح"),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "كود التأكيد يتكون من 6 أرقام"),
  newPassword: passwordPolicySchema,
});

export type ResetPasswordWithCodeInput = z.input<
  typeof resetPasswordWithCodeSchema
>;

export const storeProfileUpdateSchema = z.object({
  ownerName: z.string().trim().min(2, "اسم المالك مطلوب"),
  phone: z
    .string()
    .trim()
    .regex(/^(01[0125]\d{8}|\+201[0125]\d{8})$/, "رقم هاتف مصري غير صحيح"),
  email: z.string().trim().email("بريد إلكتروني غير صحيح"),
  storeName: z.string().trim().min(2, "اسم المحل مطلوب"),
  shopType: z.string().trim().min(2, "نوع المحل مطلوب"),
  governorate: z.string().trim().min(2, "المحافظة مطلوبة"),
  area: z.string().trim().optional(),
  openedOn: z.string().trim().optional(),
  workersCount: z.coerce.number().int().min(1, "عدد العاملين 1 على الأقل"),
});

export type StoreProfileUpdateInput = z.infer<typeof storeProfileUpdateSchema>;
