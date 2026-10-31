import arMessages from "./ar.json";

export type Messages = typeof arMessages;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Normalizes Arabic-Indic digits (٠-٩) and decimal separators to standard ASCII digits.
 */
export function normDigits(value: string | number | null | undefined): string {
  return String(value == null ? "" : value)
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/٫/g, ".")
    .replace(/،/g, "");
}

/**
 * Parses numeric input safely handling Arabic digits and non-numeric characters.
 */
export function toNum(value: string | number | null | undefined): number {
  const cleaned = normDigits(value).replace(/[^\d.-]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Translates a dot-notated key from ar.json with optional parameter substitution.
 */
export function t(
  key: string,
  params?: Record<string, string | number>,
  fallback?: string,
): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = arMessages;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return fallback !== undefined ? fallback : key;
    }
  }

  if (typeof current !== "string") {
    return fallback !== undefined ? fallback : key;
  }

  let text = current;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }

  return text;
}

/**
 * Formats integer piasters into Egyptian Pounds (ج.م).
 * Example: 1550 piasters -> "15.50 ج.م"
 */
export function formatMoney(piasters: number): string {
  const pounds = (piasters || 0) / 100;
  const formatted = pounds.toLocaleString("en-US", {
    minimumFractionDigits: pounds % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ج.م`;
}

/**
 * Formats a generic number with thousands separators.
 */
export function formatNumber(n: number): string {
  return (n || 0).toLocaleString("en-US");
}

/**
 * Formats a UTC date string or Date into Cairo time (Africa/Cairo).
 */
export function formatDateCairo(
  utcDate: string | Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date =
    typeof utcDate === "object" && utcDate instanceof Date
      ? utcDate
      : new Date(utcDate);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  return new Intl.DateTimeFormat("ar-EG", {
    ...defaultOptions,
    ...options,
  }).format(date);
}

/**
 * React hook for translation and formatting helpers.
 */
export function useTranslation() {
  return {
    t,
    formatMoney,
    formatNumber,
    formatDateCairo,
    normDigits,
    toNum,
  };
}
