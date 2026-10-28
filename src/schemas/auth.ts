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

export const passkeyCredentialResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string().optional(),
    authenticatorData: z.string().optional(),
    signature: z.string().optional(),
    userHandle: z.string().optional(),
  }),
});

export type PasskeyCredentialResponse = z.infer<
  typeof passkeyCredentialResponseSchema
>;

export const completeRegistrationInputSchema = z.object({
  credential: passkeyCredentialResponseSchema,
  label: z.string().trim().optional(),
});

export type CompleteRegistrationInput = z.infer<
  typeof completeRegistrationInputSchema
>;

export const getPasskeyAuthOptionsInputSchema = z.object({
  identifier: z.string().trim().optional(),
});

export type GetPasskeyAuthOptionsInput = z.infer<
  typeof getPasskeyAuthOptionsInputSchema
>;

export const loginWithPasskeyInputSchema = z.object({
  credential: passkeyCredentialResponseSchema,
});

export type LoginWithPasskeyInput = z.infer<typeof loginWithPasskeyInputSchema>;

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

export const completeAccountRecoveryInputSchema = z.object({
  token: z.string().min(1, "رمز الاسترداد مطلوب"),
  credential: passkeyCredentialResponseSchema,
  passkeyLabel: z.string().trim().optional(),
});

export type CompleteAccountRecoveryInput = z.infer<
  typeof completeAccountRecoveryInputSchema
>;

export const revokePasskeyInputSchema = z.object({
  passkeyId: z.string().uuid("معرف المفتاح غير صحيح"),
});

export type RevokePasskeyInput = z.infer<typeof revokePasskeyInputSchema>;

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
