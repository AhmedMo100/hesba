/**
 * @file report-periods.ts
 * @description Which report periods each package reads (ADR-0036). One place, used by the
 * report routes (the server refuses any other period) and by the reports screen and Home.
 *
 * - إدارة المحل (simple): whole calendar months only — «الشهر ده» (the 1st of this month to
 *   today), «الشهر اللي فات», or a chosen month. A month is sent as `period=custom` with
 *   `from` = its first day and `to` = its last day (today for the current month).
 * - الكاشير الذكي (pos): single days only — «النهارده», «امبارح», or a chosen day
 *   (`period=custom`, `from` = `to`).
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
    if (
      period === "custom" &&
      from &&
      DAY_KEY.test(from) &&
      (!to || to === from)
    ) {
      return from > today ? "مفيش تقرير ليوم لسه مجاش" : null;
    }
    return "تقارير «الكاشير الذكي» يومية: اختار يوم واحد.";
  }
  // إدارة المحل (and any shop whose mode is not pos).
  if (
    period === "custom" &&
    from &&
    DAY_KEY.test(from) &&
    to &&
    DAY_KEY.test(to)
  ) {
    const month = from.slice(0, 7);
    const r = monthRange(month);
    if (from !== r.from || to.slice(0, 7) !== month) {
      return "تقارير «إدارة المحل» شهرية: اختار شهر كامل.";
    }
    if (from > today) return "مفيش تقرير لشهر لسه مجاش";
    // The whole month, or (this month) up to today — a day earlier is accepted too, so a
    // screen opened just before midnight is not refused just after it.
    const expectedTo = r.to > today ? today : r.to;
    if (to === expectedTo) return null;
    if (r.to >= today && to < today && to >= dayBefore(today)) return null;
    return "تقارير «إدارة المحل» شهرية: اختار شهر كامل.";
  }
  return "تقارير «إدارة المحل» شهرية: اختار شهر.";
}
