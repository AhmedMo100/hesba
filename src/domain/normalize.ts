/**
 * Arabic text and unit normalization for catalog search, matching, and deduplication.
 * Removes diacritics, unifies letter variants, converts Arabic-Indic and Eastern digits to ASCII,
 * and standardizes measurement units (e.g. 1000g = 1kg, 1000ml = 1L).
 */

const ARABIC_DIACRITICS_REGEX = /[\u064B-\u0652\u0670\u0640]/g;

const DIGITS_MAP: Record<string, string> = {
  // Eastern Arabic-Indic numerals
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  // Persian / Urdu numerals
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * Normalizes Arabic text for canonical matching and database search.
 * Handles:
 * - Stripping diacritics (tashkeel) and elongation (tatweel).
 * - Unifying Alif variants (أ, إ, آ, ٱ -> ا).
 * - Unifying Alif Maqsura (ى -> ي).
 * - Unifying Taa Marbuta (ة -> ه) for phonetic/lexical comparison.
 * - Converting Arabic-Indic & Persian numerals to Latin (0-9).
 * - Collapsing multiple spaces and trimming.
 */
export function normalizeArabic(text: string): string {
  if (!text) return "";

  let result = text
    // Strip diacritics & tatweel
    .replace(ARABIC_DIACRITICS_REGEX, "")
    // Normalize Alif forms (أ, إ, آ, ٱ) -> ا
    .replace(/[أإآٱ]/g, "ا")
    // Normalize Alif Maqsura (ى) -> ي
    .replace(/ى/g, "ي")
    // Normalize Taa Marbuta (ة) -> ه
    .replace(/ة/g, "ه")
    // Convert Arabic-Indic & Persian digits to Latin digits
    .replace(/[٠-٩۰-۹]/g, (char) => DIGITS_MAP[char] ?? char);

  // Trim and collapse multiple whitespace characters into a single space
  result = result.trim().toLowerCase().replace(/\s+/g, " ");

  return result;
}

/**
 * Standardizes common measurement unit expressions in Arabic and English into canonical codes:
 * 'g', 'kg', 'ml', 'l', 'piece'.
 */
export function normalizeUnit(unitText: string): string {
  if (!unitText) return "";
  const norm = normalizeArabic(unitText).replace(/[.\s-]/g, "");

  if (["جم", "جرام", "غم", "g", "gram", "grams", "غرام"].includes(norm)) {
    return "g";
  }
  if (
    [
      "كجم",
      "كيلو",
      "كيلوغرام",
      "كيلوجرام",
      "ك",
      "kg",
      "kilo",
      "kilogram",
    ].includes(norm)
  ) {
    return "kg";
  }
  if (["مل", "ملل", "مليلتر", "مللي", "ml", "milliliter"].includes(norm)) {
    return "ml";
  }
  if (["لتر", "ل", "l", "liter", "liters", "litre", "litres"].includes(norm)) {
    return "l";
  }
  if (
    [
      "قطعه",
      "حبه",
      "علبه",
      "باكو",
      "كيس",
      "زجاجه",
      "قطع",
      "حبوب",
      "piece",
      "pieces",
      "pcs",
      "can",
      "box",
      "pack",
      "bottle",
    ].includes(norm)
  ) {
    return "piece";
  }

  return norm;
}

export interface NormalizedSize {
  baseValue: number;
  baseUnit: "g" | "ml" | "piece" | string;
}

/**
 * Normalizes size and unit to canonical base units (grams for weight, milliliters for volume).
 * e.g.:
 * - 1 kg -> { baseValue: 1000, baseUnit: 'g' }
 * - 1000 g -> { baseValue: 1000, baseUnit: 'g' }
 * - 1 L -> { baseValue: 1000, baseUnit: 'ml' }
 * - 1000 ml -> { baseValue: 1000, baseUnit: 'ml' }
 */
export function normalizeSize(
  value?: number | string | null,
  unit?: string | null,
): NormalizedSize | null {
  if (value === undefined || value === null || value === "") return null;
  const numVal = typeof value === "number" ? value : Number(value);
  if (isNaN(numVal) || numVal <= 0) return null;

  const stdUnit = normalizeUnit(unit ?? "");
  if (stdUnit === "kg") {
    return { baseValue: Math.round(numVal * 1000), baseUnit: "g" };
  }
  if (stdUnit === "l") {
    return { baseValue: Math.round(numVal * 1000), baseUnit: "ml" };
  }
  return { baseValue: numVal, baseUnit: stdUnit || "piece" };
}

/**
 * Compares two size/unit pairs for physical equality.
 * Correctly equates 1000g with 1kg, and 1000ml with 1L.
 */
export function areSizesEqual(
  sizeA?: { value?: number | string | null; unit?: string | null } | null,
  sizeB?: { value?: number | string | null; unit?: string | null } | null,
): boolean {
  if (!sizeA && !sizeB) return true;
  if (!sizeA || !sizeB) return false;

  const normA = normalizeSize(sizeA.value, sizeA.unit);
  const normB = normalizeSize(sizeB.value, sizeB.unit);

  if (!normA && !normB) return true;
  if (!normA || !normB) return false;

  return (
    normA.baseValue === normB.baseValue && normA.baseUnit === normB.baseUnit
  );
}
