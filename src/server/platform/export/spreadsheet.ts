/**
 * @file spreadsheet.ts
 * @description Writes report / stocktake tables as a real Excel workbook (`.xlsx`, Office Open
 * XML) or as CSV — no dependency. The workbook is a ZIP of XML parts stored without compression
 * (valid for Excel, Google Sheets, LibreOffice and phone viewers): one sheet per table, right to
 * left, a bold header row, and money as numeric cells with two decimals.
 *
 * Money is given in integer piasters and written as exact text ("1234.50"), never through a
 * float division; quantities are written as given (grams are turned into kilos by the caller as
 * exact decimal text).
 */

/** One cell: text, a plain number, money in piasters, or empty. */
export type Cell =
  string | number | null | { piasters: number } | { decimal: string };

export interface SheetTable {
  /** Sheet name (≤ 31 characters; `[]:*?/\` are replaced). */
  name: string;
  /** The first row is the header (bold). */
  rows: Cell[][];
  /** Column widths in characters. */
  widths?: number[];
}

/** Piasters → exact decimal text: 123450 → "1234.50", −5 → "-0.05". */
export function piastersText(piasters: number): string {
  const p = Math.round(piasters);
  const abs = Math.abs(p);
  return `${p < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Grams → exact kilos text: 5500 → "5.5", 1250 → "1.25". */
export function gramsToKilosText(grams: number): string {
  const g = Math.round(grams);
  const abs = Math.abs(g);
  const frac = String(abs % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${g < 0 ? "-" : ""}${Math.floor(abs / 1000)}${frac ? `.${frac}` : ""}`;
}

const xmlEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 does not allow.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const STYLE = { header: 1, money: 2, number: 3 } as const;

function cellXml(cell: Cell, ref: string, header: boolean): string {
  if (cell === null || cell === undefined || cell === "") return "";
  if (typeof cell === "string") {
    return `<c r="${ref}" t="inlineStr"${header ? ` s="${STYLE.header}"` : ""}><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`;
  }
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return "";
    return `<c r="${ref}"${header ? ` s="${STYLE.header}"` : ""}><v>${cell}</v></c>`;
  }
  if ("piasters" in cell) {
    return `<c r="${ref}" s="${STYLE.money}"><v>${piastersText(cell.piasters)}</v></c>`;
  }
  return `<c r="${ref}" s="${STYLE.number}"><v>${cell.decimal}</v></c>`;
}

function sheetXml(table: SheetTable): string {
  const cols = table.widths?.length
    ? `<cols>${table.widths
        .map(
          (w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`,
        )
        .join("")}</cols>`
    : "";
  const rows = table.rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((c, i) => cellXml(c, `${columnName(i)}${r + 1}`, r === 0))
          .join("")}</row>`,
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>' +
    `${cols}<sheetData>${rows}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.###"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

function safeSheetName(name: string, used: Set<string>): string {
  let base =
    name
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let n = 2;
  let candidate = base;
  while (used.has(candidate)) {
    const suffix = ` ${n++}`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  base = candidate;
  return base;
}

// ─── ZIP (stored, no compression) ───────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(
  files: Array<{ name: string; data: Uint8Array }>,
): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // A fixed DOS date/time (2026-01-01 00:00): the content, not the clock, makes the file.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true);
    cd.setUint16(14, dosDate, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true);
    cd.setUint16(32, 0, true);
    cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true);
    cd.setUint32(38, 0, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** The workbook bytes: one sheet per table, in order. */
export function toXlsx(tables: SheetTable[]): Uint8Array {
  const enc = new TextEncoder();
  const used = new Set<string>();
  const names = tables.map((t) => safeSheetName(t.name, used));
  const files = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          tables
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join("") +
          "</Types>",
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          "<bookViews><workbookView/></bookViews><sheets>" +
          names
            .map(
              (n, i) =>
                `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
            )
            .join("") +
          "</sheets></workbook>",
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          tables
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join("") +
          `<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          "</Relationships>",
      ),
    },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    ...tables.map((t, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(t)),
    })),
  ];
  return zipStore(files);
}

const csvField = (cell: Cell): string => {
  if (cell === null || cell === undefined) return "";
  const text =
    typeof cell === "string"
      ? cell
      : typeof cell === "number"
        ? String(cell)
        : "piasters" in cell
          ? piastersText(cell.piasters)
          : cell.decimal;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV (UTF-8 with a BOM so Excel reads Arabic): the tables one after the other. */
export function toCsv(tables: SheetTable[]): Uint8Array {
  const blocks = tables.map((t) =>
    [
      ...(tables.length > 1 ? [t.name] : []),
      ...t.rows.map((r) => r.map(csvField).join(",")),
    ].join("\r\n"),
  );
  return new TextEncoder().encode(`﻿${blocks.join("\r\n\r\n")}\r\n`);
}

export const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_TYPE = "text/csv; charset=utf-8";

/** A download response: the file's bytes and an Arabic-safe file name. */
export function fileResponse(
  bytes: Uint8Array,
  type: string,
  filename: string,
  /** A one-line summary (the share sheet's text), sent URI-encoded in a header. */
  summary?: string,
): Response {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
      ...(summary ? { "X-Hesba-Summary": encodeURIComponent(summary) } : {}),
    },
  });
}
