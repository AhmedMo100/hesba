import { z } from "zod";

export const signupInputSchema = z.object({
  ownerName: z.string().trim().min(2, "اسم صاحب المحل مطلوب"),
  phone: z
    .string()
    .trim()
    .regex(/^(01[0125]\d{8}|\+201[0125]\d{8})$/, "رقم هاتف مصري غير صحيح"),
  email: z.string().trim().email("بريد إلكتروني غير صحيح"),
  password: z
    .string()
    .min(6, "كلمة السر يجب أن تكون 6 حروف أو أرقام على الأقل"),
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
  newPassword: z
    .string()
    .min(6, "كلمة السر الجديدة يجب أن تكون 6 حروف أو أرقام على الأقل"),
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
