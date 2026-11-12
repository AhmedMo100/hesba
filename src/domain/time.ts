/**
 * Time and timezone utilities:
 * - Timestamps are stored in UTC in the database.
 * - Displayed to users in Cairo time (Africa/Cairo).
 */

export const CAIRO_TIMEZONE = "Africa/Cairo";

/**
 * Normalizes input date to a valid Date object.
 */
export function ensureDate(date: Date | string | number): Date {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`Invalid date input: ${date}`);
  }
  return d;
}

/**
 * Returns UTC ISO 8601 string for database storage.
 */
export function toUtcIsoString(date: Date | string | number): string {
  return ensureDate(date).toISOString();
}

/**
 * Formats a timestamp into Cairo local date & time.
 * Example: "25/10/2026, 04:30 م"
 */
export function formatCairoDateTime(
  date: Date | string | number,
  options?: {
    locale?: "ar-EG" | "en-US";
    includeSeconds?: boolean;
  },
): string {
  const d = ensureDate(date);
  const locale = options?.locale ?? "ar-EG";
  const includeSeconds = options?.includeSeconds ?? false;

  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: CAIRO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: true,
  });

  return formatter.format(d);
}

/**
 * Formats a timestamp into Cairo date only.
 * Example: "25/10/2026"
 */
export function formatCairoDate(
  date: Date | string | number,
  locale: "ar-EG" | "en-US" = "ar-EG",
): string {
  const d = ensureDate(date);
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: CAIRO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d);
}

/**
 * Formats a timestamp into Cairo time only.
 * Example: "04:30 م"
 */
export function formatCairoTime(
  date: Date | string | number,
  locale: "ar-EG" | "en-US" = "ar-EG",
): string {
  const d = ensureDate(date);
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: CAIRO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return formatter.format(d);
}

/**
 * Returns the calendar date (YYYY-MM-DD) for a given UTC timestamp in Cairo local time.
 */
export function toCairoDateString(date: Date | string | number): string {
  const d = ensureDate(date);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(d); // Outputs YYYY-MM-DD
}

/** The hour (0–23) of a timestamp in Cairo local time. */
export function cairoHour(date: Date | string | number): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(ensureDate(date));
  return Number(h) % 24;
}

/** Adds `days` calendar days to a `YYYY-MM-DD` date key. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * The UTC instant at which a Cairo calendar day (`YYYY-MM-DD`) starts (00:00 in Cairo),
 * correct across daylight-saving changes.
 */
export function cairoDayStartUtc(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CAIRO_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(t));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const wall = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
    );
    return wall - t;
  };
  let start = guess - offsetAt(guess);
  start = guess - offsetAt(start);
  return new Date(start);
}
