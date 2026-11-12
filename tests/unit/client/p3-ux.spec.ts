/**
 * QA-43 (Arabic unit words on Home), QA-49 (web app manifest) and the obsolete
 * `interest-cohort` Permissions-Policy directive.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { packWord, unitWord } from "@/client/shared/unit-labels";
import { formatQtyText } from "@/client/features/home/HomeView";
import manifest from "@/app/manifest";
import { securityHeaders } from "@/server/config/security-headers";

describe("QA-43 — Home shows Arabic unit and pack words, never codes", () => {
  it("translates the stored unit codes", () => {
    expect(unitWord("piece")).toBe("قطعة");
    expect(unitWord("PIECE")).toBe("قطعة");
    expect(unitWord(undefined)).toBe("قطعة");
    expect(unitWord("bag")).toBe("كيس");
    expect(unitWord("carton")).toBe("كرتونة");
    expect(unitWord("kg")).toBe("كجم");
    // A word the owner typed stays as is.
    expect(unitWord("صباع")).toBe("صباع");
  });

  it("uses the product's own pack word, and never guesses كرتونة", () => {
    expect(packWord("carton", 24)).toBe("كرتونة");
    expect(packWord("bag", 10)).toBe("كيس");
    expect(packWord("dozen", 12)).toBe("دستة");
    expect(packWord("ربطة", 10)).toBe("ربطة");
    // A size code is not a pack word; no pack word → دستة for 12, else عبوة.
    expect(packWord("piece", 10)).toBe("عبوة");
    expect(packWord(null, 10)).toBe("عبوة");
    expect(packWord(null, 12)).toBe("دستة");
  });

  it("formats the audit's examples without English", () => {
    expect(formatQtyText("piece", 19, 1, "piece")).toBe("19 قطعة");
    expect(formatQtyText("piece", 120, 24, "piece", "carton")).toBe("5 كرتونة");
    // The 10-piece bread pack: "1 كرتونة و 8 piece" before.
    expect(formatQtyText("piece", 18, 10, "piece")).toBe("1 عبوة و 8 قطعة");
    expect(formatQtyText("piece", 18, 10, "piece", "bag")).toBe(
      "1 كيس و 8 قطعة",
    );
    expect(formatQtyText("weight", 1500, 1, "kg")).toBe("1.5 كجم");
    for (const text of [
      formatQtyText("piece", 19, 1, "piece"),
      formatQtyText("piece", 18, 10, "piece", "carton"),
    ]) {
      expect(text).not.toMatch(/[a-z]/i);
    }
  });
});

describe("QA-49 — the app is installable", () => {
  const m = manifest();
  it("has a complete manifest", () => {
    expect(m.name).toBe("حسبة");
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/app");
    expect(m.display).toBe("standalone");
    expect(m.dir).toBe("rtl");
    expect(m.lang).toBe("ar");
    expect(m.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(m.background_color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("lists real 192 px and 512 px PNG icons (and a maskable one)", () => {
    const sizes = new Set<string>();
    for (const icon of m.icons ?? []) {
      const file = path.join(process.cwd(), "public", icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const png = readFileSync(file);
      // PNG signature, then IHDR width and height.
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      const w = png.readUInt32BE(16);
      const h = png.readUInt32BE(20);
      expect(`${w}x${h}`).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
      sizes.add(icon.sizes!);
    }
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
  });
});

describe("Permissions-Policy has no obsolete directives", () => {
  it("does not send interest-cohort (FLoC), and keeps the other restrictions", () => {
    for (const production of [true, false]) {
      const h = securityHeaders({ production, hstsIncludeSubdomains: false });
      const pp = h.find((x) => x.key === "Permissions-Policy")!.value;
      expect(pp).not.toContain("interest-cohort");
      for (const d of [
        "camera=()",
        "microphone=(self)",
        "geolocation=()",
        "payment=()",
        "usb=()",
        "serial=()",
        "bluetooth=()",
      ]) {
        expect(pp).toContain(d);
      }
    }
  });
});
