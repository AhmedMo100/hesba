import { describe, expect, it } from "vitest";
import { normalizeArabic } from "@/domain/normalize";

describe("domain/normalize - Arabic text normalization", () => {
  it("normalizes Alif variations (أ, إ, آ, ٱ -> ا)", () => {
    expect(normalizeArabic("أحمد")).toBe("احمد");
    expect(normalizeArabic("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabic("آيس كريم")).toBe("ايس كريم");
    expect(normalizeArabic("ٱمرأة")).toBe("امراه");
  });

  it("normalizes Alif Maqsura (ى -> ي)", () => {
    expect(normalizeArabic("حلوانى")).toBe("حلواني");
    expect(normalizeArabic("مستشفى")).toBe("مستشفي");
    expect(normalizeArabic("شاي")).toBe("شاي");
  });

  it("normalizes Taa Marbuta (ة -> ه)", () => {
    expect(normalizeArabic("بقالة")).toBe("بقاله");
    expect(normalizeArabic("شوكولاتة")).toBe("شوكولاته");
    expect(normalizeArabic("جبنة بيضاء")).toBe("جبنه بيضاء");
  });

  it("converts Arabic-Indic digits (٠-٩) to ASCII digits (0-9)", () => {
    expect(normalizeArabic("كولا ٢٥٠ مل")).toBe("كولا 250 مل");
    expect(normalizeArabic("شاي العروسة ١٠٠ جم")).toBe("شاي العروسه 100 جم");
    expect(normalizeArabic("سعر ٥٠ قرش")).toBe("سعر 50 قرش");
  });

  it("strips diacritics (tashkeel and tatweel)", () => {
    expect(normalizeArabic("شَيْبْسِي")).toBe("شيبسي");
    expect(normalizeArabic("مُـنْـتَـجْ")).toBe("منتج");
  });

  it("collapses multiple spaces and trims edges", () => {
    expect(normalizeArabic("  بيبسي   دايت   ")).toBe("بيبسي دايت");
  });

  it("handles empty or blank inputs", () => {
    expect(normalizeArabic("")).toBe("");
    expect(normalizeArabic("   ")).toBe("");
  });
});
