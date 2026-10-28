import { z } from "zod";

export const signupInputSchema = z.object({
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
  openedOn: z.string().trim().min(4, "تاريخ الافتتاح مطلوب"),
  workersCount: z.coerce.number().int().min(1, "عدد العاملين 1 على الأقل"),
  withDemoData: z.boolean().optional().default(false),
});

export type SignupInput = z.infer<typeof signupInputSchema>;
export type SignupInputRaw = z.input<typeof signupInputSchema>;

export const magicLinkRequestSchema = z.object({
  email: z.string().trim().email("بريد إلكتروني غير صحيح"),
});

export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1, "رمز التحقق مطلوب"),
});

export type MagicLinkVerifyInput = z.infer<typeof magicLinkVerifySchema>;

export const emailVerificationSchema = z.object({
  token: z.string().min(1, "رمز التأكيد مطلوب"),
});

export type EmailVerificationInput = z.infer<typeof emailVerificationSchema>;

export const accountRecoveryRequestSchema = z.object({
  email: z.string().trim().email("بريد إلكتروني غير صحيح"),
});

export type AccountRecoveryRequestInput = z.infer<
  typeof accountRecoveryRequestSchema
>;

export const verifyRecoveryTokenInputSchema = z.object({
  token: z.string().min(1, "رمز الاسترداد مطلوب"),
});

export type VerifyRecoveryTokenInput = z.infer<
  typeof verifyRecoveryTokenInputSchema
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
  openedOn: z.string().trim().min(4, "تاريخ الافتتاح مطلوب"),
  workersCount: z.coerce.number().int().min(1, "عدد العاملين 1 على الأقل"),
});

export type StoreProfileUpdate = z.infer<typeof storeProfileUpdateSchema>;
