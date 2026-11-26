/**
 * @file stocktake-report.ts
 * @description The stocktake report a shop owner can download or share from the phone: a short
 * Arabic summary (text) and the full table (CSV, opens in Excel / Google Sheets). Built only from
 * the server's count (`GET /api/inventory-counts/:id`): nothing is estimated here.
 */

export type CountReason =
  "unrecorded_sale" | "damaged" | "expired" | "lost" | "unknown" | "surplus";

export interface ReportLine {
  productName: string;
  category: string;
  unit: string;
  expectedBase: number;
  countedBase: number | null;
  differenceBase: number | null;
  reason: CountReason | null;
  /** The owner's note on the difference. */
  note?: string | null;
  differenceCostPiasters: number | null;
  appliedCostPiasters?: number | null;
}

export interface ReportCount {
  id: string;
  scope: string;
  category: string | null;
  status: "open" | "confirmed" | "abandoned";
  startedAt: string;
  confirmedAt: string | null;
  abandonedAt?: string | null;
  startedBy?: string | null;
  closedBy?: string | null;
  salesMode?: "simple" | "pos";
  totals: {
    lines: number;
    counted: number;
    matched: number;
    discrepancies: number;
    shortageCostPiasters: number;
    surplusCostPiasters: number;
    damagedBase: number;
    expiredBase?: number;
    lostBase: number;
    shortageLines?: number;
    surplusLines?: number;
    unrecordedSaleBase: number;
    unknownBase: number;
    unrecordedSaleSellPiasters?: number;
  };
  lines: ReportLine[];
}

export const REASON_LABEL: Record<CountReason, string> = {
  damaged: "تالف",
  expired: "منتهي الصلاحية",
  lost: "مفقود",
  unrecorded_sale: "اتباع ومتسجلش",
  unknown: "سبب آخر",
  surplus: "زيادة",
};

export const SCOPE_LABEL: Record<string, string> = {
  full: "كل المحل",
  category: "قسم",
  selected: "منتجات معينة",
};

const STATUS_LABEL: Record<ReportCount["status"], string> = {
  open: "لسه شغال",
  confirmed: "اتطبّق على المخزون",
  abandoned: "اتلغى (مفيش حاجة اتغيرت)",
};

const egp = (piasters: number) =>
  `${(piasters / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج`;

const qty = (unit: string, base: number) =>
  unit === "kg"
    ? `${Number((base / 1000).toFixed(3))} كيلو`
    : `${base.toLocaleString("en-US")}`;

const date = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** «جرد كل المحل» / «جرد قسم بقالة» / «جرد منتجات معينة». */
export function scopeText(c: Pick<ReportCount, "scope" | "category">): string {
  if (c.scope === "category" && c.category) return `قسم «${c.category}»`;
  return SCOPE_LABEL[c.scope] ?? c.scope;
}

/** The short report, in Egyptian Arabic, ready to paste on WhatsApp. */
export function buildReportText(c: ReportCount): string {
  const t = c.totals;
  const diffs = c.lines.filter(
    (l) => l.differenceBase !== null && l.differenceBase !== 0,
  );
  const out: string[] = [];
  out.push(`📋 تقرير جرد — ${scopeText(c)}`);
  out.push(`التاريخ: ${date(c.confirmedAt ?? c.abandonedAt ?? c.startedAt)}`);
  if (c.startedBy) out.push(`بدأه: ${c.startedBy}`);
  if (c.closedBy)
    out.push(`${c.status === "confirmed" ? "طبّقه" : "لغاه"}: ${c.closedBy}`);
  out.push(`الحالة: ${STATUS_LABEL[c.status]}`);
  out.push("");
  out.push(`المنتجات اللي اتعدّت: ${t.counted} من ${t.lines}`);
  out.push(`مظبوطة: ${t.matched} · فيها فرق: ${t.discrepancies}`);
  out.push(`قيمة الناقص (بسعر الشراء): ${egp(t.shortageCostPiasters)}`);
  if (t.surplusCostPiasters > 0)
    out.push(`قيمة الزيادة (بسعر الشراء): ${egp(t.surplusCostPiasters)}`);
  if (diffs.length > 0) {
    out.push("");
    out.push("الفروق:");
    for (const l of diffs) {
      const d = l.differenceBase!;
      const reason =
        (l.reason ? REASON_LABEL[l.reason] : "من غير سبب") +
        (l.note ? ` — ${l.note}` : "");
      out.push(
        `• ${l.productName}: المتوقع ${qty(l.unit, l.expectedBase)} · الموجود ${qty(l.unit, l.countedBase ?? 0)} · الفرق ${d > 0 ? "+" : "−"}${qty(l.unit, Math.abs(d))} (${reason})`,
      );
    }
  }
  out.push("");
  out.push(
    c.status === "confirmed"
      ? "✅ الفروق دي اتطبقت على المخزون مرة واحدة."
      : c.status === "abandoned"
        ? "الجرد ده اتلغى: المخزون ما اتغيرش."
        : "الجرد لسه ما اتطبقش.",
  );
  out.push("— من حِسبة");
  return out.join("\n");
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The full table (UTF-8 with BOM so Excel shows the Arabic). */
export function buildReportCsv(c: ReportCount): string {
  const head = [
    "المنتج",
    "القسم",
    "المتوقع",
    "الموجود",
    "الفرق",
    "السبب",
    "ملاحظة",
    "قيمة الفرق (ج)",
    "اتطبق بقيمة (ج)",
  ];
  const rows = c.lines.map((l) => [
    l.productName,
    l.category,
    qty(l.unit, l.expectedBase),
    l.countedBase === null ? "ما اتعدّش" : qty(l.unit, l.countedBase),
    l.differenceBase === null
      ? ""
      : `${l.differenceBase > 0 ? "+" : ""}${l.unit === "kg" ? Number((l.differenceBase / 1000).toFixed(3)) : l.differenceBase}`,
    l.reason ? REASON_LABEL[l.reason] : "",
    l.note ?? "",
    l.differenceCostPiasters === null
      ? ""
      : (l.differenceCostPiasters / 100).toFixed(2),
    l.appliedCostPiasters == null
      ? ""
      : (l.appliedCostPiasters / 100).toFixed(2),
  ]);
  return (
    "﻿" +
    [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

/** A file name the phone can keep: «جرد-2026-11-24.csv». */
export function reportFileName(c: ReportCount, ext: "csv" | "txt"): string {
  const d = (c.confirmedAt ?? c.startedAt).slice(0, 10);
  return `جرد-${d}.${ext}`;
}

/**
 * What the count does to the money (ADR-0039), only from the server's numbers — a value that is
 * not known is left out, never guessed:
 * - `unrecordedSalePiasters`: «اتباع ومتسجلش» at the selling price (الكاشير الذكي only; in إدارة
 *   المحل its money is already in the day's totals, so it is 0 there).
 * - `lossPiasters`: تالف / منتهي / مفقود at cost (what was applied once confirmed, else the
 *   estimate at the line's cost). `lossUnknownLines`: lines whose cost is not known.
 */
export function countMoneyEffects(c: ReportCount): {
  unrecordedSalePiasters: number;
  lossPiasters: number;
  lossUnknownLines: number;
} {
  let lossPiasters = 0;
  let lossUnknownLines = 0;
  for (const l of c.lines) {
    if (l.differenceBase === null || l.differenceBase >= 0) continue;
    if (l.reason !== "damaged" && l.reason !== "expired" && l.reason !== "lost")
      continue;
    const v = l.appliedCostPiasters ?? l.differenceCostPiasters;
    if (v === null || v === undefined) lossUnknownLines += 1;
    else lossPiasters += v;
  }
  return {
    unrecordedSalePiasters:
      c.salesMode === "simple" ? 0 : (c.totals.unrecordedSaleSellPiasters ?? 0),
    lossPiasters,
    lossUnknownLines,
  };
}
