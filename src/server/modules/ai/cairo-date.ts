import "server-only";
import { CAIRO_TIMEZONE } from "./constants";

/**
 * Returns the current date in Cairo formatted as YYYY-MM-DD.
 */
export function getCairoDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Returns a JavaScript Date set to midnight UTC for the Cairo calendar day.
 * Used for PostgreSQL DATE columns.
 */
export function getCairoMidnightDate(date: Date = new Date()): Date {
  const dateStr = getCairoDateString(date);
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * Formats a Cairo date into conversational Arabic.
 * Example: "31 أكتوبر 2026"
 */
export function formatCairoArabicDate(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    timeZone: CAIRO_TIMEZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return formatter.format(date);
}

/**
 * Generates the automatic conversation title for the Cairo day.
 * Example: "محادثة 31 أكتوبر 2026"
 */
export function getCairoConversationTitle(date: Date = new Date()): string {
  return `محادثة ${formatCairoArabicDate(date)}`;
}

/**
 * Returns the exact UTC Date of the next Cairo midnight.
 * Used by clients to display when their quota will replenish.
 */
export function getNextCairoMidnight(fromDate: Date = new Date()): Date {
  const todayStr = getCairoDateString(fromDate);
  const testTime = fromDate.getTime();
  const maxSearch = testTime + 30 * 60 * 60 * 1000;

  // Binary search for midnight within 1 second precision
  let low = testTime;
  let high = maxSearch;
  let midnightMs = high;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midDate = new Date(mid);
    const midStr = getCairoDateString(midDate);

    if (midStr > todayStr) {
      midnightMs = mid;
      high = mid - 1000; // Look for earlier transition
    } else {
      low = mid + 1000; // Need later time
    }
  }

  // Round to exact second
  return new Date(Math.floor(midnightMs / 1000) * 1000);
}

/**
 * Computes the retention cutoff date in Cairo.
 * Any conversation strictly before this date (more than `days` old) is eligible for deletion.
 */
export function getRetentionCutoffDate(
  retentionDays = 7,
  fromDate: Date = new Date(),
): Date {
  const todayMidnight = getCairoMidnightDate(fromDate);
  const cutoffTime =
    todayMidnight.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return new Date(cutoffTime);
}
