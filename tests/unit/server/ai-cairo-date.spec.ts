import { describe, it, expect } from "vitest";
import {
  getCairoDateString,
  getCairoMidnightDate,
  formatCairoArabicDate,
  getCairoConversationTitle,
  getNextCairoMidnight,
  getRetentionCutoffDate,
} from "@/server/modules/ai/cairo-date";

describe("AI Cairo Date and Retention Utilities", () => {
  it("formats date into YYYY-MM-DD for Cairo timezone", () => {
    // 2026-10-31 22:30 UTC is 2026-11-01 00:30 in Cairo (UTC+2)
    const lateUtc = new Date("2026-10-31T22:30:00Z");
    const cairoDate = getCairoDateString(lateUtc);
    expect(cairoDate).toBe("2026-11-01");
  });

  it("returns Cairo midnight UTC date for database DATE columns", () => {
    const testDate = new Date("2026-10-31T15:00:00Z");
    const midnight = getCairoMidnightDate(testDate);
    expect(midnight.toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });

  it("generates Arabic long title using Egyptian date format", () => {
    const testDate = new Date("2026-10-31T12:00:00Z");
    const title = getCairoConversationTitle(testDate);
    expect(title).toBe("محادثة 31 أكتوبر 2026");
    expect(formatCairoArabicDate(testDate)).toBe("31 أكتوبر 2026");
  });

  it("calculates next Cairo midnight accurately", () => {
    const now = new Date("2026-10-31T14:00:00Z");
    const nextMidnight = getNextCairoMidnight(now);

    expect(nextMidnight.getTime()).toBeGreaterThan(now.getTime());
    // The next midnight should be at 00:00:00 Cairo time
    const midnightStr = getCairoDateString(nextMidnight);
    const todayStr = getCairoDateString(now);
    expect(midnightStr).not.toBe(todayStr);
  });

  it("calculates 7-day retention cutoff date", () => {
    const ref = new Date("2026-10-31T12:00:00Z");
    const cutoff = getRetentionCutoffDate(7, ref);

    const diffDays =
      (getCairoMidnightDate(ref).getTime() - cutoff.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7);
  });
});
