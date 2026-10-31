import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { t } from "@/client/shared/i18n";
import arMessages from "@/client/shared/i18n/ar.json";

describe("People Module i18n Verification", () => {
  it("has Arabic Egyptian translations for all keys used in PeopleView", () => {
    const peopleViewPath = path.resolve(
      __dirname,
      "../../../src/client/app-shell/views/PeopleView.tsx",
    );
    const content = fs.readFileSync(peopleViewPath, "utf-8");

    // Extract all t("...") calls
    const matches = content.match(/t\(\s*["']([^"']+)["']/g) || [];
    const keys = Array.from(
      new Set(
        matches.map((m) => m.replace(/t\(\s*["']/, "").replace(/["']$/, "")),
      ),
    );

    expect(keys.length).toBeGreaterThan(10);

    for (const key of keys) {
      const translated = t(key);
      // Translation must not equal the raw key
      expect(
        translated,
        `Key "${key}" was returned literally without translation!`,
      ).not.toBe(key);
      // Translation must be a non-empty string
      expect(typeof translated).toBe("string");
      expect(translated.trim().length).toBeGreaterThan(0);
    }
  });

  it("verifies essential form and financial keys exist in ar.json under pages.people", () => {
    const peopleTranslations = arMessages.pages.people;

    expect(peopleTranslations.formName).toBe("الاسم");
    expect(peopleTranslations.formPhone).toBe("رقم التليفون");
    expect(peopleTranslations.formNote).toBe("ملاحظة (اختياري)");
    expect(peopleTranslations.formSupplies).toBe("بيورّدلك إيه؟");
    expect(peopleTranslations.nameRequired).toBe("اكتب الاسم");
    expect(peopleTranslations.owedToMeOptional).toBe("المبلغ ليك (اختياري)");
    expect(peopleTranslations.owedByMeOptional).toBe("المبلغ عليك (اختياري)");
    expect(peopleTranslations.remainingOptional).toBe("المتبقي له (اختياري)");
    expect(peopleTranslations.deleteMessage).toContain("{name}");
    expect(peopleTranslations.totalReceivable).toBe("إجمالي المستحق");
    expect(peopleTranslations.totalObligations).toBe("إجمالي الالتزامات");
    expect(peopleTranslations.totalSuppliersOwed).toBe(
      "إجمالي المستحق للموردين",
    );
    expect(peopleTranslations.statement).toBe("كشف حساب");
  });
});
