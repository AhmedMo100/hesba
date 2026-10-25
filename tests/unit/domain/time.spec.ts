import { describe, expect, it } from "vitest";
import {
  formatCairoDate,
  formatCairoDateTime,
  formatCairoTime,
  toCairoDateString,
  toUtcIsoString,
} from "@/domain/time";

describe("domain/time - UTC storage and Cairo display", () => {
  it("stores timestamps in UTC ISO format", () => {
    const date = new Date("2026-10-25T13:30:00.000Z");
    expect(toUtcIsoString(date)).toBe("2026-10-25T13:30:00.000Z");
  });

  it("converts UTC timestamp to Cairo calendar date string (YYYY-MM-DD)", () => {
    // 2026-10-25 22:30 UTC is 2026-10-26 in Cairo (UTC+3 summer or UTC+2 winter)
    // At 23:00 UTC, Cairo is always on the next calendar day
    const utcNight = new Date("2026-10-25T23:30:00.000Z");
    expect(toCairoDateString(utcNight)).toBe("2026-10-26");

    const utcMorning = new Date("2026-10-25T10:00:00.000Z");
    expect(toCairoDateString(utcMorning)).toBe("2026-10-25");
  });

  it("formats Cairo date and time accurately", () => {
    // Winter time: 2026-01-15T12:00:00Z -> Cairo is UTC+2 -> 14:00 (02:00 م)
    const winterDate = new Date("2026-01-15T12:00:00.000Z");
    const winterCairoDate = formatCairoDate(winterDate, "en-US");
    expect(winterCairoDate).toBe("01/15/2026");

    const winterCairoTime = formatCairoTime(winterDate, "en-US");
    expect(winterCairoTime).toBe("02:00 PM");

    // Summer time (DST): 2026-06-15T12:00:00Z -> Cairo is UTC+3 -> 15:00 (03:00 PM)
    const summerDate = new Date("2026-06-15T12:00:00.000Z");
    const summerCairoTime = formatCairoTime(summerDate, "en-US");
    expect(summerCairoTime).toBe("03:00 PM");
  });

  it("formats Cairo date time with Arabic locale", () => {
    const date = new Date("2026-10-25T13:00:00.000Z");
    const formatted = formatCairoDateTime(date, { locale: "ar-EG" });
    // In ar-EG, Arabic-Indic digits are used (٢٠٢٦ and م for PM)
    expect(formatted).toContain("٢٠٢٦");
    expect(formatted).toContain("م");
  });

  it("throws error on invalid date inputs", () => {
    expect(() => toUtcIsoString("invalid-date")).toThrow(TypeError);
    expect(() => formatCairoDate("invalid-date")).toThrow(TypeError);
    expect(() => toCairoDateString("invalid-date")).toThrow(TypeError);
  });
});
