import { z } from "zod";

/**
 * Strict dates for request bodies (QA-37). A date must be a real calendar date — `2026-13-45`
 * is refused, never rolled over to another day — and within a sensible range:
 * - a business date (an expense, a debt or payment, a production date) is not before
 *   {@link MIN_BUSINESS_DATE} and not after tomorrow (one day of slack for time zones);
 * - an expiry date may be in the future, up to {@link MAX_EXPIRY_YEARS} years ahead.
 *
 * Accepted text: `YYYY-MM-DD`, or a full ISO 8601 date-time (`2026-11-12T10:00:00.000Z`).
 */

export const MIN_BUSINESS_DATE = "2000-01-01";
export const MAX_EXPIRY_YEARS = 30;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 3600_000;

/** The date the text names, or null when it is not a real date. */
export function parseStrictDate(text: string): Date | null {
  const m = DATE_ONLY.exec(text);
  if (m) {
    const d = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text
      ? d
      : null;
  }
  if (!z.iso.datetime({ offset: true }).safeParse(text).success) return null;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  // The calendar part must be real too (no rollover of 2026-02-30T…).
  const day = text.slice(0, 10);
  const check = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) &&
    check.toISOString().slice(0, 10) === day
    ? d
    : null;
}

const min = () => new Date(`${MIN_BUSINESS_DATE}T00:00:00Z`);

function bounded(
  label: string,
  max: () => Date,
  tooLate: string,
): z.ZodType<string> {
  return z.string().superRefine((text, ctx) => {
    const d = parseStrictDate(text);
    if (!d) {
      ctx.addIssue({ code: "custom", message: `${label} غير صحيح` });
      return;
    }
    if (d < min()) {
      ctx.addIssue({ code: "custom", message: `${label} قديم قوي` });
    } else if (d > max()) {
      ctx.addIssue({ code: "custom", message: tooLate });
    }
  });
}

/** An expense / debt / payment / production date: a real date, not in the future. */
export const businessDateSchema = bounded(
  "التاريخ",
  () => new Date(Date.now() + DAY_MS),
  "التاريخ لسه مجاش",
);

/** An expiry date: a real date, at most {@link MAX_EXPIRY_YEARS} years ahead. */
export const expiryDateSchema = bounded(
  "تاريخ الصلاحية",
  () => new Date(Date.now() + MAX_EXPIRY_YEARS * 365 * DAY_MS),
  "تاريخ الصلاحية بعيد قوي",
);
