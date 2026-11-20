/**
 * The export writer (no dependency): exact money and kilo text, a valid ZIP (CRC-32), the
 * workbook parts Excel needs, right-to-left sheets, escaping, and CSV with a BOM.
 */
import { describe, expect, it } from "vitest";
import {
  crc32,
  gramsToKilosText,
  piastersText,
  toCsv,
  toXlsx,
} from "@/server/platform/export/spreadsheet";

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("export spreadsheet", () => {
  it("writes money and kilos exactly", () => {
    expect(piastersText(123450)).toBe("1234.50");
    expect(piastersText(5)).toBe("0.05");
    expect(piastersText(-1275)).toBe("-12.75");
    expect(gramsToKilosText(5500)).toBe("5.5");
    expect(gramsToKilosText(1250)).toBe("1.25");
    expect(gramsToKilosText(1)).toBe("0.001");
    expect(gramsToKilosText(3000)).toBe("3");
  });

  it("CRC-32 of a known string", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("an .xlsx is a ZIP with the workbook parts, right to left, escaped", () => {
    const bytes = toXlsx([
      {
        name: "الجرد",
        rows: [
          ["المنتج", "القيمة"],
          ["<زيت & سمن>", { piasters: 12345 }],
        ],
      },
      { name: "a/b*c", rows: [["x"]] },
    ]);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
    const all = text(bytes);
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]) {
      expect(all).toContain(part);
    }
    expect(all).toContain('<sheetView rightToLeft="1"');
    expect(all).not.toContain("workbookView rightToLeft");
    expect(all).toContain("&lt;زيت &amp; سمن&gt;");
    expect(all).toContain("<v>123.45</v>");
    expect(all).toContain('name="a b c"');
  });

  it("CSV: a BOM, quoted fields, exact money", () => {
    const bytes = toCsv([
      {
        name: "t",
        rows: [
          ["اسم", "مبلغ"],
          ['زيت, "عباد"', { piasters: 1050 }],
        ],
      },
    ]);
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(bytes)).toContain('"زيت, ""عباد""",10.50');
  });
});
