/**
 * @file report-periods.ts
 * @description Which report periods each package reads (ADR-0036, ranges since 2026-11-25).
 * One place, used by the report routes (the server refuses any other period) and by the
 * reports screen and Home. Each package keeps its own unit; the owner picks the range.
 *
 * - إدارة المحل (simple): whole calendar months — «الشهر ده», «الشهر اللي فات», a year, or a
 *   range of months (from the 1st of a month to the last day of the same or a later month;
 *   today for the current month). Sent as `period=custom&from=…&to=…`.
 * - الكاشير الذكي (pos): days — «النهارده», «امبارح», a year, or a range of days (`from`…`to`,
 *   one day when they are equal).
 * - Both: the end never before the start, nothing in the future, and at most one year
 *   (12 months / 366 days) in one report.
 *
 * Pure: dates are Cairo day keys (YYYY-MM-DD); `today` is passed in.
 */

import type { OperatingMode } from "./operating-mode";

export type ReportPeriodName =
  "today" | "yesterday" | "week" | "month" | "year" | "all" | "custom";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** «2026-11» → first and last day keys of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(last).padStart(2, "0")}`,
  };
}

/** The month («YYYY-MM») before `month`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The range a simple shop asks for one month: the whole month, or up to today for the
 * current month (a report never reads the future).
 */
export function monthQuery(
  month: string,
  today: string,
): { period: "custom"; from: string; to: string } {
  const r = monthRange(month);
  return { period: "custom", from: r.from, to: r.to > today ? today : r.to };
}

/** The longest report: one year (12 whole months for إدارة المحل, 366 days for الكاشير الذكي). */
export const REPORT_MAX_MONTHS = 12;
export const REPORT_MAX_DAYS = 366;

const dayNumber = (day: string) => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const monthNumber = (dayOrMonth: string) => {
  const [y, m] = dayOrMonth.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
};

/** The range of months «YYYY-MM»…«YYYY-MM» (whole months; the current one up to today). */
export function monthsQuery(
  fromMonth: string,
  toMonth: string,
  today: string,
): { period: "custom"; from: string; to: string } {
  const end = monthRange(toMonth).to;
  return {
    period: "custom",
    from: monthRange(fromMonth).from,
    to: end > today ? today : end,
  };
}

/** A whole year: 1 January to 31 December (up to today for the current year). */
export function yearQuery(
  year: number,
  today: string,
): { period: "custom"; from: string; to: string } {
  const end = `${year}-12-31`;
  return {
    period: "custom",
    from: `${year}-01-01`,
    to: end > today ? today : end,
  };
}

/**
 * Why a period is refused: `invalid` — not a valid range at all (a bad date, the end before the
 * start, the future, longer than a year) → 400; `package` — a range this package does not
 * read (another unit) → 403. Null when it is allowed.
 */
export interface ReportPeriodProblem {
  kind: "invalid" | "package";
  message: string;
}

const INVALID = new Set([
  "التاريخ غير صحيح",
  "آخر الفترة قبل أولها",
  "مفيش تقرير لأيام لسه مجتش",
  "آخر الفترة لسه مجاش: اختار لحد النهارده",
  "أطول تقرير سنة واحدة (366 يوم). قسّم الفترة.",
  "مفيش تقرير لشهر لسه مجاش",
  "آخر الفترة لسه مجاش: اختار لحد الشهر ده",
  "أطول تقرير سنة واحدة (12 شهر). قسّم الفترة.",
]);

export function reportPeriodProblem(
  mode: OperatingMode | string | null | undefined,
  period: ReportPeriodName,
  from: string | undefined,
  to: string | undefined,
  today: string,
): ReportPeriodProblem | null {
  const message = reportPeriodRefusal(mode, period, from, to, today);
  if (!message) return null;
  return { kind: INVALID.has(message) ? "invalid" : "package", message };
}

/** The Arabic reason a period is refused for this package; null when it is allowed. */
export function reportPeriodRefusal(
  mode: OperatingMode | string | null | undefined,
  period: ReportPeriodName,
  from: string | undefined,
  to: string | undefined,
  today: string,
): string | null {
  if (mode === "pos") {
    if (period === "today" || period === "yesterday") return null;
    if (period === "custom" && from && DAY_KEY.test(from)) {
      const end = to ?? from;
      if (!DAY_KEY.test(end)) return "التاريخ غير صحيح";
      if (end < from) return "آخر الفترة قبل أولها";
      if (from > today) return "مفيش تقرير لأيام لسه مجتش";
      if (end > today) return "آخر الفترة لسه مجاش: اختار لحد النهارده";
      if (dayNumber(end) - dayNumber(from) + 1 > REPORT_MAX_DAYS)
        return "أطول تقرير سنة واحدة (366 يوم). قسّم الفترة.";
      return null;
    }
    return "تقارير «الكاشير الذكي» بالأيام: اختار يوم، أو من يوم لحد يوم، أو سنة.";
  }
  // إدارة المحل (and any shop whose mode is not pos): whole months.
  if (
    period === "custom" &&
    from &&
    DAY_KEY.test(from) &&
    to &&
    DAY_KEY.test(to)
  ) {
    if (to < from) return "آخر الفترة قبل أولها";
    if (from !== monthRange(from.slice(0, 7)).from)
      return "تقارير «إدارة المحل» بالشهور: الفترة بتبدأ من أول الشهر.";
    if (from > today) return "مفيش تقرير لشهر لسه مجاش";
    const endOfToMonth = monthRange(to.slice(0, 7)).to;
    // The last day of a past month, or — the current month — today (a day earlier is
    // accepted too, so a screen opened just before midnight is not refused just after it).
    const wholeMonth = to === endOfToMonth && to <= today;
    const upToToday =
      endOfToMonth >= today && (to === today || to === dayBefore(today));
    if (!wholeMonth && !upToToday) {
      return to > today
        ? "آخر الفترة لسه مجاش: اختار لحد الشهر ده"
        : "تقارير «إدارة المحل» بالشهور: الفترة بتخلص في آخر الشهر.";
    }
    if (monthNumber(to) - monthNumber(from) + 1 > REPORT_MAX_MONTHS)
      return "أطول تقرير سنة واحدة (12 شهر). قسّم الفترة.";
    return null;
  }
  return "تقارير «إدارة المحل» بالشهور: اختار شهر، أو من شهر لحد شهر، أو سنة.";
}
