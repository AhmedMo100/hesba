import { describe, it, expect } from "vitest";
import {
  t,
  formatMoney,
  formatNumber,
  formatDateCairo,
  normDigits,
  toNum,
} from "@/client/shared/i18n";

describe("i18n and formatting utilities", () => {
  it("translates nested keys and substitutes parameters", () => {
    expect(t("common.appName")).toBe("حسبة");
    expect(t("common.save")).toBe("حفظ");
    expect(t("sync.offline", { count: 5 })).toBe("5 عمليات مستنية (أوفلاين)");
  });

  it("returns key if not found", () => {
    expect(t("non.existent.key")).toBe("non.existent.key");
  });

  it("contains clean marketing copy without demo version claims in auth strings", () => {
    expect(t("auth.loginSub")).toBe(
      "أهلاً بعودتك، خلّي إدارة محلك أسهل مع حِسبة.",
    );
    expect(t("auth.signupSub")).toBe(
      "ابدأ تنظيم حسابات محلك ومخزونه مع حِسبة.",
    );
    expect(t("auth.forgotPasswordSub")).toBe(
      "خطوة بسيطة وترجع لحسابك وتكمل شغلك.",
    );
    expect(t("auth.loginPasswordPlaceholder")).toBe("كلمة السر");
  });

  it("formats piasters as Egyptian Pounds with ج.م suffix", () => {
    expect(formatMoney(1550)).toBe("15.50 ج.م");
    expect(formatMoney(1500)).toBe("15 ج.م");
    expect(formatMoney(0)).toBe("0 ج.م");
    expect(formatMoney(75)).toBe("0.75 ج.م");
  });

  it("formats generic numbers with commas", () => {
    expect(formatNumber(1250000)).toBe("1,250,000");
  });

  it("formats UTC dates into Cairo timezone", () => {
    // 2026-10-15T12:00:00Z is in October 2026
    const formatted = formatDateCairo("2026-10-15T12:00:00Z");
    expect(formatted).toBeTruthy();
    expect(formatted).toContain("أكتوبر");
    expect(normDigits(formatted)).toContain("2026");
  });

  it("normalizes Arabic-Indic digits to ASCII standard digits", () => {
    expect(normDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normDigits("١٥٫٥٠")).toBe("15.50");
    expect(normDigits("١،٠٠٠")).toBe("1000");
  });

  it("parses numbers accurately with toNum", () => {
    expect(toNum("١٥٫٥")).toBe(15.5);
    expect(toNum("100")).toBe(100);
    expect(toNum("abc")).toBe(0);
  });
});
