/**
 * @file date-range.ts
 * @description Period filters on the Cairo calendar (the shop's business day), shared by the
 * screens that filter lists by date (stock additions history, …). Pure: no I/O.
 *
 * Presets (inclusive Cairo calendar days):
 * - `today` / `yesterday`: that one day;
 * - `week`: the last 7 days, today included;
 * - `month` / `year`: the current calendar month / year up to today;
 * - `custom`: one day (`from` only, or `from === to`) or `from` → `to` (swapped if reversed).
 */

import { addDaysToDateKey, toCairoDateString } from "./time";

export const DATE_PRESETS = [
  "today",
  "yesterday",
  "week",
  "month",
  "year",
  "custom",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface DateFilter {
  preset: DatePreset;
  /** `custom` only: `YYYY-MM-DD` (Cairo). */
  from?: string;
  to?: string;
}

/** Inclusive Cairo day keys, or null when a custom filter has no date yet (= no filter). */
export interface DateKeyRange {
  fromKey: string;
  toKey: string;
}

const KEY = /^\d{4}-\d{2}-\d{2}$/;

export function cairoDateRange(
  filter: DateFilter,
  now: Date | number = Date.now(),
): DateKeyRange | null {
  const today = toCairoDateString(now);
  switch (filter.preset) {
    case "today":
      return { fromKey: today, toKey: today };
    case "yesterday": {
      const y = addDaysToDateKey(today, -1);
      return { fromKey: y, toKey: y };
    }
    case "week":
      return { fromKey: addDaysToDateKey(today, -6), toKey: today };
    case "month":
      return { fromKey: `${today.slice(0, 7)}-01`, toKey: today };
    case "year":
      return { fromKey: `${today.slice(0, 4)}-01-01`, toKey: today };
    case "custom": {
      const from = filter.from && KEY.test(filter.from) ? filter.from : null;
      const to = filter.to && KEY.test(filter.to) ? filter.to : null;
      if (!from && !to) return null;
      const a = from ?? to!;
      const b = to ?? from!;
      return a <= b ? { fromKey: a, toKey: b } : { fromKey: b, toKey: a };
    }
  }
}

/** Whether a UTC timestamp falls on one of the range's Cairo days. Null range = everything. */
export function inCairoRange(
  at: Date | string | number,
  range: DateKeyRange | null,
): boolean {
  if (!range) return true;
  const key = toCairoDateString(at);
  return key >= range.fromKey && key <= range.toKey;
}
