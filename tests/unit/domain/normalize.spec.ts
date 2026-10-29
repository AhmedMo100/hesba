import { describe, expect, it } from "vitest";
import {
  areSizesEqual,
  normalizeArabic,
  normalizeSize,
  normalizeUnit,
} from "@/domain/normalize";

describe("domain/normalize - Arabic text normalization", () => {
  it("normalizes Alif variations (أ, إ, آ, ٱ -> ا)", () => {
    expect(normalizeArabic("أحمد")).toBe("احمد");
    expect(normalizeArabic("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabic("آيس كريم")).toBe("ايس كريم");
    expect(normalizeArabic("ٱمرأة")).toBe("امراه");
    expect(normalizeArabic("أرز مصري فاخر")).toBe("ارز مصري فاخر");
    expect(normalizeArabic("إندومي خضار")).toBe("اندومي خضار");
  });

  it("normalizes Alif Maqsura (ى -> ي)", () => {
    expect(normalizeArabic("حلوانى")).toBe("حلواني");
    expect(normalizeArabic("مستشفى")).toBe("مستشفي");
    expect(normalizeArabic("شاي")).toBe("شاي");
    expect(normalizeArabic("الضحى")).toBe("الضحي");
    expect(normalizeArabic("دومتى")).toBe("دومتي");
    expect(normalizeArabic("فرسكى")).toBe("فرسكي");
  });

  it("normalizes Taa Marbuta (ة -> ه)", () => {
    expect(normalizeArabic("بقالة")).toBe("بقاله");
    expect(normalizeArabic("شوكولاتة")).toBe("شوكولاته");
    expect(normalizeArabic("جبنة بيضاء")).toBe("جبنه بيضاء");
    expect(normalizeArabic("صلصة طماطم")).toBe("صلصه طماطم");
    expect(normalizeArabic("مكرونة الملكة")).toBe("مكرونه الملكه");
    expect(normalizeArabic("زبدة فيرن")).toBe("زبده فيرن");
  });

  it("converts Arabic-Indic digits (٠-٩) and Persian digits (۰-۹) to ASCII (0-9)", () => {
    expect(normalizeArabic("كولا ٢٥٠ مل")).toBe("كولا 250 مل");
    expect(normalizeArabic("شاي العروسة ١٠٠ جم")).toBe("شاي العروسه 100 جم");
    expect(normalizeArabic("سعر ٥٠ قرش")).toBe("سعر 50 قرش");
    expect(normalizeArabic("وزن ۱۰۰۰ گرم")).toBe("وزن 1000 گرم");
    expect(normalizeArabic("عبوة ۵۰۰ مل")).toBe("عبوه 500 مل");
    expect(normalizeArabic("حجم ۱.۵ لتر")).toBe("حجم 1.5 لتر");
  });

  it("strips diacritics (tashkeel and tatweel)", () => {
    expect(normalizeArabic("شَيْبْسِي")).toBe("شيبسي");
    expect(normalizeArabic("مُـنْـتَـجْ")).toBe("منتج");
    expect(normalizeArabic("سُـكَّـرْ نَـاعِـمْ")).toBe("سكر ناعم");
    expect(normalizeArabic("شَـايْ أَسْـوَدْ")).toBe("شاي اسود");
  });

  it("collapses multiple spaces and trims edges", () => {
    expect(normalizeArabic("  بيبسي   دايت   ")).toBe("بيبسي دايت");
    expect(normalizeArabic("   زيت   عافية    ذرة   ")).toBe("زيت عافيه ذره");
  });

  it("handles empty or blank inputs", () => {
    expect(normalizeArabic("")).toBe("");
    expect(normalizeArabic("   ")).toBe("");
  });

  it("normalizes real Egyptian supermarket product names (30+ items)", () => {
    const products = [
      { raw: "شاي ليبتون ناعم ٢٥٠ جم", expected: "شاي ليبتون ناعم 250 جم" },
      { raw: "شاي العروسة ١٠٠ جم", expected: "شاي العروسه 100 جم" },
      {
        raw: "حليب جُهَيْنَة كامل الدسم ١ لتر",
        expected: "حليب جهينه كامل الدسم 1 لتر",
      },
      { raw: "جبنة دومتي فيتا ٥٠٠ غرام", expected: "جبنه دومتي فيتا 500 غرام" },
      { raw: "جبنة لافاش كيري ٨ قطع", expected: "جبنه لافاش كيري 8 قطع" },
      {
        raw: "مكرونة الملكة خواتم ٤٠٠ جم",
        expected: "مكرونه الملكه خواتم 400 جم",
      },
      { raw: "أرز الضحى مصري ١ كجم", expected: "ارز الضحي مصري 1 كجم" },
      { raw: "زيت ذرة عافية ٨٠٠ مل", expected: "زيت ذره عافيه 800 مل" },
      {
        raw: "زيت عباد الشمس كريستال ١.٦ لتر",
        expected: "زيت عباد الشمس كريستال 1.6 لتر",
      },
      {
        raw: "سمنة روابي بطعم القشطة ٧٠٠ جم",
        expected: "سمنه روابي بطعم القشطه 700 جم",
      },
      { raw: "سمن نباتي الهانم ١.٥ كجم", expected: "سمن نباتي الهانم 1.5 كجم" },
      {
        raw: "تونة صن شاين قطعة واحدة تونة بيضاء",
        expected: "تونه صن شاين قطعه واحده تونه بيضاء",
      },
      { raw: "فول مدمس هارفست ٤٠٠ جم", expected: "فول مدمس هارفست 400 جم" },
      { raw: "صلصة طماطم هاينز ٣٦٠ جم", expected: "صلصه طماطم هاينز 360 جم" },
      {
        raw: "كاتشب هاينز عبوة ضاغطة ٢٨٥ جم",
        expected: "كاتشب هاينز عبوه ضاغطه 285 جم",
      },
      {
        raw: "مايونيز هاينز أصلي ٣١٠ جم",
        expected: "مايونيز هاينز اصلي 310 جم",
      },
      {
        raw: "بسكويت أولكر لوكس محشو كريمة",
        expected: "بسكويت اولكر لوكس محشو كريمه",
      },
      {
        raw: "بسكويت شاي ميري فيري ٥٠ جم",
        expected: "بسكويت شاي ميري فيري 50 جم",
      },
      { raw: "ويفر فريسكا شوكولاتة", expected: "ويفر فريسكا شوكولاته" },
      {
        raw: "شيكولاتة مورو كراميل ونوجا",
        expected: "شيكولاته مورو كراميل ونوجا",
      },
      {
        raw: "شيبسي بطعم الجبنة المتبلة",
        expected: "شيبسي بطعم الجبنه المتبله",
      },
      {
        raw: "شيبسي بالفلفل الحلو ٥٥ جم",
        expected: "شيبسي بالفلفل الحلو 55 جم",
      },
      {
        raw: "دوريتوس بطعم الجبنة الناتشو ٤٥ جم",
        expected: "دوريتوس بطعم الجبنه الناتشو 45 جم",
      },
      { raw: "شيبسي كرانشي شطة وليمون", expected: "شيبسي كرانشي شطه وليمون" },
      {
        raw: "مياه معدنية إيفيان ٥٠٠ مل",
        expected: "مياه معدنيه ايفيان 500 مل",
      },
      {
        raw: "مياه نستله بيور لايف ١.٥ لتر",
        expected: "مياه نستله بيور لايف 1.5 لتر",
      },
      {
        raw: "مشروب غازي كوكاكولا كانز ٣٣٠ مل",
        expected: "مشروب غازي كوكاكولا كانز 330 مل",
      },
      {
        raw: "عصير بيتي برتقال تتراباك ٢٠٠ مل",
        expected: "عصير بيتي برتقال تتراباك 200 مل",
      },
      {
        raw: "عصير لمار تفاح بدون سكر ١ لتر",
        expected: "عصير لمار تفاح بدون سكر 1 لتر",
      },
      {
        raw: "مسحوق أوتوماتيك إريال ٤ كجم",
        expected: "مسحوق اوتوماتيك اريال 4 كجم",
      },
      {
        raw: "جل غسيل برسيل لافندر ٢.٥ لتر",
        expected: "جل غسيل برسيل لافندر 2.5 لتر",
      },
      {
        raw: "صابون سائل فيري بليمون ٦٢٠ مل",
        expected: "صابون سائل فيري بليمون 620 مل",
      },
      {
        raw: "صابون تواليت دوف أبيض ١٣٥ جم",
        expected: "صابون تواليت دوف ابيض 135 جم",
      },
      {
        raw: "معجون أسنان سيجنال تو مكافح التسوس ٧٥ مل",
        expected: "معجون اسنان سيجنال تو مكافح التسوس 75 مل",
      },
      { raw: "مناديل مطبخ زينة ٤ رول", expected: "مناديل مطبخ زينه 4 رول" },
    ];

    for (const { raw, expected } of products) {
      expect(normalizeArabic(raw)).toBe(expected);
    }
  });

  describe("Unit normalization & physical size equality", () => {
    it("normalizes various Arabic and English unit forms to standard codes", () => {
      expect(normalizeUnit("جرام")).toBe("g");
      expect(normalizeUnit("جم")).toBe("g");
      expect(normalizeUnit("غم")).toBe("g");
      expect(normalizeUnit("غرام")).toBe("g");
      expect(normalizeUnit("g")).toBe("g");

      expect(normalizeUnit("كيلو")).toBe("kg");
      expect(normalizeUnit("كجم")).toBe("kg");
      expect(normalizeUnit("كيلوجرام")).toBe("kg");
      expect(normalizeUnit("kg")).toBe("kg");

      expect(normalizeUnit("مل")).toBe("ml");
      expect(normalizeUnit("مليلتر")).toBe("ml");
      expect(normalizeUnit("ml")).toBe("ml");

      expect(normalizeUnit("لتر")).toBe("l");
      expect(normalizeUnit("ل")).toBe("l");
      expect(normalizeUnit("l")).toBe("l");
      expect(normalizeUnit("liters")).toBe("l");

      expect(normalizeUnit("قطعة")).toBe("piece");
      expect(normalizeUnit("حبه")).toBe("piece");
      expect(normalizeUnit("علبة")).toBe("piece");
    });

    it("correctly equates physical sizes (1000g == 1kg, 1000ml == 1L)", () => {
      // 1000g equals 1kg
      expect(
        areSizesEqual({ value: 1000, unit: "g" }, { value: 1, unit: "kg" }),
      ).toBe(true);
      expect(
        areSizesEqual(
          { value: "1000", unit: "جم" },
          { value: "1", unit: "كجم" },
        ),
      ).toBe(true);
      expect(
        areSizesEqual({ value: 500, unit: "جم" }, { value: 0.5, unit: "كيلو" }),
      ).toBe(true);

      // 1000ml equals 1L
      expect(
        areSizesEqual({ value: 1000, unit: "ml" }, { value: 1, unit: "l" }),
      ).toBe(true);
      expect(
        areSizesEqual(
          { value: "1000", unit: "مل" },
          { value: "1", unit: "لتر" },
        ),
      ).toBe(true);
      expect(
        areSizesEqual({ value: 1500, unit: "ml" }, { value: 1.5, unit: "l" }),
      ).toBe(true);

      // Different physical quantities must NOT be equal
      expect(
        areSizesEqual({ value: 250, unit: "g" }, { value: 500, unit: "g" }),
      ).toBe(false);
      expect(
        areSizesEqual({ value: 1, unit: "l" }, { value: 2, unit: "l" }),
      ).toBe(false);
      expect(
        areSizesEqual({ value: 1000, unit: "g" }, { value: 1000, unit: "ml" }),
      ).toBe(false);
    });

    it("handles normalizeSize edge cases", () => {
      expect(normalizeSize(null, null)).toBeNull();
      expect(normalizeSize(0, "g")).toBeNull();
      expect(normalizeSize(-50, "g")).toBeNull();
      expect(normalizeSize(2, "كجم")).toEqual({
        baseValue: 2000,
        baseUnit: "g",
      });
      expect(normalizeSize(1.5, "لتر")).toEqual({
        baseValue: 1500,
        baseUnit: "ml",
      });
      expect(normalizeSize(6, "قطع")).toEqual({
        baseValue: 6,
        baseUnit: "piece",
      });
    });
  });
});
