/**
 * Stock additions history filters (اليوم، امبارح، الأسبوع، الشهر، السنة، فترة مخصصة) on the
 * Cairo calendar, whatever the device's timezone.
 */
import { describe, expect, it } from "vitest";
import { cairoDateRange, inCairoRange } from "@/domain/date-range";

// 23:30 UTC on Nov 10 is already 01:30 on Nov 11 in Cairo (UTC+2).
const NOW = new Date("2026-11-10T23:30:00Z");

describe("cairoDateRange", () => {
  it("presets are Cairo calendar days", () => {
    expect(cairoDateRange({ preset: "today" }, NOW)).toEqual({
      fromKey: "2026-11-11",
      toKey: "2026-11-11",
    });
    expect(cairoDateRange({ preset: "yesterday" }, NOW)).toEqual({
      fromKey: "2026-11-10",
      toKey: "2026-11-10",
    });
    expect(cairoDateRange({ preset: "week" }, NOW)).toEqual({
      fromKey: "2026-11-05",
      toKey: "2026-11-11",
    });
    expect(cairoDateRange({ preset: "month" }, NOW)).toEqual({
      fromKey: "2026-11-01",
      toKey: "2026-11-11",
    });
    expect(cairoDateRange({ preset: "year" }, NOW)).toEqual({
      fromKey: "2026-01-01",
      toKey: "2026-11-11",
    });
  });

  it("custom: one day, a range, a reversed range, or nothing yet", () => {
    expect(
      cairoDateRange({ preset: "custom", from: "2026-10-03" }, NOW),
    ).toEqual({ fromKey: "2026-10-03", toKey: "2026-10-03" });
    expect(
      cairoDateRange(
        { preset: "custom", from: "2026-10-03", to: "2026-10-03" },
        NOW,
      ),
    ).toEqual({ fromKey: "2026-10-03", toKey: "2026-10-03" });
    expect(
      cairoDateRange(
        { preset: "custom", from: "2026-10-01", to: "2026-10-31" },
        NOW,
      ),
    ).toEqual({ fromKey: "2026-10-01", toKey: "2026-10-31" });
    expect(
      cairoDateRange(
        { preset: "custom", from: "2026-10-31", to: "2026-10-01" },
        NOW,
      ),
    ).toEqual({ fromKey: "2026-10-01", toKey: "2026-10-31" });
    expect(
      cairoDateRange({ preset: "custom", from: "", to: "" }, NOW),
    ).toBeNull();
    expect(cairoDateRange({ preset: "custom", from: "bad" }, NOW)).toBeNull();
  });
});

describe("inCairoRange", () => {
  it("a late-evening UTC addition belongs to the next Cairo day", () => {
    const today = cairoDateRange({ preset: "today" }, NOW);
    const yesterday = cairoDateRange({ preset: "yesterday" }, NOW);
    // 22:30 UTC Nov 10 = 00:30 Nov 11 Cairo → today, not yesterday.
    expect(inCairoRange("2026-11-10T22:30:00Z", today)).toBe(true);
    expect(inCairoRange("2026-11-10T22:30:00Z", yesterday)).toBe(false);
    // 21:59 UTC Nov 10 = 23:59 Nov 10 Cairo → yesterday.
    expect(inCairoRange("2026-11-10T21:59:00Z", yesterday)).toBe(true);
  });

  it("range ends are inclusive; no range = everything", () => {
    const r = { fromKey: "2026-10-01", toKey: "2026-10-31" };
    expect(inCairoRange("2026-09-30T22:00:00Z", r)).toBe(true); // Oct 1 00:00 Cairo
    expect(inCairoRange("2026-10-31T21:59:59Z", r)).toBe(true); // Oct 31 23:59 Cairo
    expect(inCairoRange("2026-10-31T22:00:00Z", r)).toBe(false); // Nov 1 Cairo
    expect(inCairoRange("2020-01-01T00:00:00Z", null)).toBe(true);
  });
});
