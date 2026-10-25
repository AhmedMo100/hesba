/**
 * Arabic text normalization for catalog search and deduplication.
 * Removes diacritics, unifies letter variants, converts Arabic-Indic digits to ASCII,
 * and collapses whitespace.
 */

const ARABIC_DIACRITICS_REGEX = /[\u064B-\u0652\u0670\u0640]/g;

const ARABIC_INDIC_DIGITS_MAP: Record<string, string> = {
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
};

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
    // Convert Arabic-Indic digits to ASCII digits
    .replace(/[٠-٩]/g, (char) => ARABIC_INDIC_DIGITS_MAP[char] ?? char);

  // Trim and collapse multiple whitespace characters into a single space
  result = result.trim().toLowerCase().replace(/\s+/g, " ");

  return result;
}
