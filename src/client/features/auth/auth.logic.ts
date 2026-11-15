export const GOVERNORATES = [
  "القاهرة",
  "الجيزة",
  "الإسكندرية",
  "القليوبية",
  "الشرقية",
  "الدقهلية",
  "الغربية",
  "المنوفية",
  "البحيرة",
  "كفر الشيخ",
  "دمياط",
  "بورسعيد",
  "الإسماعيلية",
  "السويس",
  "الفيوم",
  "بني سويف",
  "المنيا",
  "أسيوط",
  "سوهاج",
  "قنا",
  "الأقصر",
  "أسوان",
  "البحر الأحمر",
  "الوادي الجديد",
  "مطروح",
  "شمال سيناء",
  "جنوب سيناء",
];

export const SHOP_TYPES = [
  "سوبر ماركت",
  "بقالة",
  "ميني ماركت",
  "جملة / نص جملة",
  "أخرى",
];

export function normDigits(v: string): string {
  return v
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[0-9]/g, (d) => d);
}

export function okPhone(v: string): boolean {
  const clean = normDigits(v).replace(/\s|-/g, "");
  return /^01[0125]\d{8}$/.test(clean);
}

export function okMail(v: string): boolean {
  if (!v || !v.trim()) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

export function isEmailIdentifier(v: string): boolean {
  return v.includes("@");
}

type TFn = (key: string, params?: Record<string, string | number>) => string;

export function validateSignup(
  data: { storeName: string; phone: string; email?: string; password: string },
  t: TFn,
  validatePasswordPolicy: (pw: string) => { valid: boolean; reason?: string },
): Record<string, string> {
  const errs: Record<string, string> = {};

  if (!data.storeName.trim()) {
    errs["storeName"] = t("errors.writeStoreName");
  }

  if (!okPhone(data.phone)) {
    errs["phone"] = t("errors.invalidPhone");
  }

  if (data.email && data.email.trim() && !okMail(data.email)) {
    errs["email"] = t("errors.invalidEmail");
  }

  const pwdRes = validatePasswordPolicy(data.password);
  if (!pwdRes.valid) {
    const reason = pwdRes.reason as string;
    if (reason === "too_short" || reason === "empty") {
      errs["password"] = t("auth.passwordLength");
    } else if (reason === "missing_letter") {
      errs["password"] = t("auth.passwordMissingLetter");
    } else if (reason === "missing_number") {
      errs["password"] = t("auth.passwordMissingNumber");
    } else if (reason === "too_long") {
      errs["password"] = t("auth.passwordTooLong");
    } else if (reason === "too_common") {
      errs["password"] = t("auth.passwordTooCommon");
    }
  }

  return errs;
}
