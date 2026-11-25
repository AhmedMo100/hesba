"use client";

/**
 * @file ReportsView.tsx
 * @description Reports, in the order a shop owner asks: how much did I sell, how much did I
 * earn, how much did I spend, how much stock came in, how much was lost, what sells best —
 * and how it was paid, last. All from the server's report for the chosen period. A profit
 * whose cost is not recorded is shown as unknown, never estimated (ADR-0021). Reports only
 * show: cancelling a stock entry is done from «دخلت بضاعة».
 *
 * The period depends on the package (ADR-0036), and the server refuses any other one:
 * - إدارة المحل: months — «الشهر ده» (from the 1st), «الشهر اللي فات», or a chosen month.
 * - الكاشير الذكي: days — «النهارده», «امبارح», or a chosen day.
 * Export (⬇) and share (📤) are two small icons: the same server file (Excel), downloaded, or
 * handed to the phone's share sheet (WhatsApp…) with the report's summary.
 */

import React, { useEffect, useRef, useState } from "react";
import { PageTitle, Skeleton, useToast } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import { apiGet } from "@/client/shared/api/read-cache";
import {
  canShareFile,
  downloadFile,
  fetchExport,
  shareFile,
  type ExportedFile,
} from "@/client/shared/api/export-file";
import { useAuth } from "@/client/shared/auth";
import { modeOf } from "../subscription/access";
import { WASTE_REASON_LABELS, type WasteReason } from "@/schemas/inventory";
import type { ReportPeriod } from "@/schemas/report";
import { toCairoDateString } from "@/domain/time";
import {
  monthQuery,
  monthsQuery,
  previousMonth,
  reportPeriodProblem,
  yearQuery,
} from "@/domain/report-periods";
import styles from "./HomeView.module.css";

/**
 * The period chips of each package (ADR-0036, ranges since 2026-11-25). Each package keeps its
 * unit — days for الكاشير الذكي, whole months for إدارة المحل — and the owner picks a year or
 * any range («فترة») of that unit, up to one year. The server checks the same rule.
 */
type PeriodKey =
  "today" | "yesterday" | "thisMonth" | "lastMonth" | "year" | "range";
const POS_PERIODS: Array<[PeriodKey, string]> = [
  ["today", "النهارده"],
  ["yesterday", "امبارح"],
  ["year", "السنة"],
  ["range", "فترة"],
];
const SIMPLE_PERIODS: Array<[PeriodKey, string]> = [
  ["thisMonth", "الشهر ده"],
  ["lastMonth", "الشهر اللي فات"],
  ["year", "السنة"],
  ["range", "فترة"],
];

interface PeriodInputs {
  year: number;
  /** الكاشير الذكي: days «YYYY-MM-DD». */
  dayFrom: string;
  dayTo: string;
  /** إدارة المحل: months «YYYY-MM». */
  monthFrom: string;
  monthTo: string;
}

/** The report request of a chosen period. */
function periodQuery(
  key: PeriodKey,
  pos: boolean,
  today: string,
  inputs: PeriodInputs,
): { period: ReportPeriod; from?: string; to?: string } {
  const thisMonth = today.slice(0, 7);
  switch (key) {
    case "today":
    case "yesterday":
      return { period: key };
    case "thisMonth":
      return monthQuery(thisMonth, today);
    case "lastMonth":
      return monthQuery(previousMonth(thisMonth), today);
    case "year":
      return yearQuery(inputs.year, today);
    case "range":
      return pos
        ? { period: "custom", from: inputs.dayFrom, to: inputs.dayTo }
        : monthsQuery(inputs.monthFrom, inputs.monthTo, today);
  }
}

/** One stock movement as `/api/stock?view=all` returns it. */
interface StockMove {
  id: string;
  batchId?: string | null;
  productName: string;
  flavor?: string | null;
  unitMode?: "piece" | "weight";
  type: string;
  quantityBase: number;
  costTotalMinor?: number | null;
  costPricePiasters?: number | null;
  supplierName?: string | null;
  expiryDate?: string | null;
  createdAt: string;
}

/** One expense as `/api/expenses` returns it. */
interface ExpenseRow {
  id: string;
  category: string;
  amount_piasters: number;
  note?: string | null;
  spent_at: string;
}

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));

export function ReportsView() {
  const { session } = useAuth();
  const mode = modeOf(session ?? null, session?.store?.id ?? null);
  const periods = mode === "pos" ? POS_PERIODS : SIMPLE_PERIODS;
  const [today] = useState(() => toCairoDateString(new Date()));
  // The package's first period: today (الكاشير الذكي) or this month (إدارة المحل) — the same
  // number as Home's profit card.
  const [key, setKey] = useState<PeriodKey>(
    mode === "pos" ? "today" : "thisMonth",
  );
  // A shop whose package was just switched: its first period of the new package.
  if (!periods.some(([k]) => k === key)) setKey(periods[0]![0]);
  const thisYear = Number(today.slice(0, 4));
  const [inputs, setInputs] = useState<PeriodInputs>(() => ({
    year: thisYear,
    dayFrom: today,
    dayTo: today,
    monthFrom: today.slice(0, 7),
    monthTo: today.slice(0, 7),
  }));
  const setInput = <K extends keyof PeriodInputs>(k: K, v: PeriodInputs[K]) =>
    setInputs((prev) => ({ ...prev, [k]: v }));
  const q = periodQuery(key, mode === "pos", today, inputs);
  const period = q.period;
  const from = q.from ?? today;
  const to = q.to ?? today;
  // The same rule as the server: a range that is not valid is explained here, not requested.
  const rangeProblem =
    reportPeriodProblem(mode, period, q.from, q.to, today)?.message ?? null;
  const [report, setReport] = useState<HomeReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The stock that came in (the old stock screen's additions log), for the same period.
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  // The period's expenses, one by one (the expenses screen shows today only).
  const [expenseList, setExpenseList] = useState<ExpenseRow[] | null>(null);

  // Every batch received in the report's range (the server reads the range, not the last 100
  // movements of any kind — a month or a year is complete).
  const reportFrom = report?.from ?? null;
  const reportTo = report?.to ?? null;
  useEffect(() => {
    if (!reportTo) return;
    let alive = true;
    const qs = new URLSearchParams({ view: "additions", to: reportTo });
    if (reportFrom) qs.set("from", reportFrom);
    apiGet(`/api/stock?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMoves(d?.movements ?? []))
      .catch(() => alive && setMoves([]));
    return () => {
      alive = false;
    };
  }, [reportFrom, reportTo]);
  const toast = useToast();
  // The export file is fetched on the first touch of an icon, so the share sheet can open
  // from the tap itself (browsers allow it only right after the tap).
  const exportUrl = `/api/reports/export?${new URLSearchParams({
    period,
    ...(period === "custom" ? { from, to } : {}),
    format: "xlsx",
  }).toString()}`;
  const filePromise = useRef<{ url: string; p: Promise<ExportedFile> } | null>(
    null,
  );
  const prepareFile = () => {
    if (filePromise.current?.url !== exportUrl) {
      const p = fetchExport(exportUrl, "تقرير حسبة.xlsx");
      p.catch(() => {
        if (filePromise.current?.p === p) filePromise.current = null;
      });
      filePromise.current = { url: exportUrl, p };
    }
    return filePromise.current.p;
  };
  const [fileBusy, setFileBusy] = useState<"download" | "share" | null>(null);
  const exportReport = async (how: "download" | "share") => {
    setFileBusy(how);
    try {
      const ready = await prepareFile();
      if (how === "download" || !canShareFile(ready.file)) {
        downloadFile(ready.file);
        toast.show({
          msg:
            how === "download"
              ? "التقرير اتنزّل على الجهاز ✅"
              : "الجهاز ده مش بيشارك ملفات، فالتقرير اتنزّل. ابعته من واتساب: 📎 ← مستند.",
          kind: "ok",
        });
        return;
      }
      const r = await shareFile(ready.file, ready.summary || "تقرير حسبة");
      if (r === "shared") toast.show({ msg: "اتشارك التقرير ✅", kind: "ok" });
    } catch (e: unknown) {
      toast.show({
        msg: e instanceof Error ? e.message : "مقدرناش نجهّز التقرير",
        kind: "err",
      });
    } finally {
      setFileBusy(null);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (rangeProblem) {
      // Nothing is requested for an invalid range, and no old numbers stay on screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the range changed
      setReport(null);
      setFailed(false);
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    fetchHomeReport(period, controller.signal, { from, to })
      .then((r) => {
        setReport(r);
        setFailed(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failed load never leaves the previous period's numbers under the new chip.
        setReport(null);
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, from, to, rangeProblem]);

  // The expenses of the report's own range (Cairo days).
  const rangeFrom = report?.from
    ? toCairoDateString(new Date(report.from))
    : null;
  const rangeTo = report?.to
    ? toCairoDateString(new Date(Date.parse(report.to) - 1))
    : null;
  useEffect(() => {
    if (!rangeFrom || !rangeTo) return;
    let alive = true;
    apiGet(`/api/expenses?period=custom&from=${rangeFrom}&to=${rangeTo}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setExpenseList(d?.expenses ?? []))
      .catch(() => alive && setExpenseList([]));
    return () => {
      alive = false;
    };
  }, [rangeFrom, rangeTo]);

  const sales = report?.sales;
  const profit = sales?.grossProfitPiasters ?? null;
  const expenses = report?.expenses.totalPiasters ?? 0;
  const losses = report?.losses.costPiasters ?? 0;
  const left = profit === null ? null : profit - expenses - losses;
  const pay = report?.byPaymentMethod;
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : formatMoney(v);

  // Only stock that came into the shop: received batches (never a sale or its undo).
  const additions = (moves ?? []).filter((m) => {
    if (m.type !== "purchase" && m.type !== "initial_stock") return false;
    if (m.quantityBase <= 0 || !report) return false;
    const at = Date.parse(m.createdAt);
    return (
      (!report.from || at >= Date.parse(report.from)) &&
      at < Date.parse(report.to)
    );
  });

  return (
    <div className={styles.page} data-testid="page-reports" dir="rtl">
      <div className={styles.reportHead}>
        <PageTitle className={styles.reportTitle}>محلك ماشي إزاي؟</PageTitle>
        <div className={styles.reportIcons}>
          <button
            type="button"
            className={styles.iconBtn}
            onPointerDown={() => void prepareFile()}
            onClick={() => void exportReport("download")}
            disabled={fileBusy !== null || rangeProblem !== null}
            aria-label="نزّل التقرير (Excel)"
            title="نزّل التقرير"
            data-testid="report-export"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v12m0 0-5-5m5 5 5-5M5 21h14" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onPointerDown={() => void prepareFile()}
            onClick={() => void exportReport("share")}
            disabled={fileBusy !== null || rangeProblem !== null}
            aria-label="شارك التقرير (واتساب وغيره)"
            title="شارك التقرير"
            data-testid="report-share"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="18" cy="5" r="2.5" />
              <circle cx="6" cy="12" r="2.5" />
              <circle cx="18" cy="19" r="2.5" />
              <path d="m8.2 10.8 7.6-4.4m-7.6 6.8 7.6 4.4" />
            </svg>
          </button>
        </div>
      </div>
      <div className={styles.chips} role="tablist">
        {periods.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={key === k}
            className={`${styles.chip} ${key === k ? styles.chipOn : ""}`}
            onClick={() => setKey(k)}
            data-testid={`report-period-${k}`}
          >
            {label}
          </button>
        ))}
      </div>
      {key === "year" && (
        <label>
          <span className={styles.lbl}>السنة</span>
          <select
            className={styles.input}
            value={inputs.year}
            onChange={(e) => setInput("year", Number(e.target.value))}
            data-testid="report-year"
          >
            {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      )}
      {key === "range" && (
        <div className={styles.rangeRow} data-testid="report-range-pick">
          <label>
            <span className={styles.lbl}>من</span>
            {mode === "pos" ? (
              <input
                type="date"
                className={styles.input}
                value={inputs.dayFrom}
                max={today}
                onChange={(e) => setInput("dayFrom", e.target.value || today)}
                data-testid="report-from"
              />
            ) : (
              <input
                type="month"
                className={styles.input}
                value={inputs.monthFrom}
                max={today.slice(0, 7)}
                onChange={(e) =>
                  setInput("monthFrom", e.target.value || today.slice(0, 7))
                }
                data-testid="report-from"
              />
            )}
          </label>
          <label>
            <span className={styles.lbl}>لحد</span>
            {mode === "pos" ? (
              <input
                type="date"
                className={styles.input}
                value={inputs.dayTo}
                max={today}
                onChange={(e) => setInput("dayTo", e.target.value || today)}
                data-testid="report-to"
              />
            ) : (
              <input
                type="month"
                className={styles.input}
                value={inputs.monthTo}
                max={today.slice(0, 7)}
                onChange={(e) =>
                  setInput("monthTo", e.target.value || today.slice(0, 7))
                }
                data-testid="report-to"
              />
            )}
          </label>
        </div>
      )}
      {rangeProblem && (
        <div
          className={styles.warn}
          role="alert"
          data-testid="report-range-error"
        >
          {rangeProblem}
        </div>
      )}
      {report?.from && (
        <div className={styles.note} data-testid="report-range">
          من {dayLabel(report.from)} لحد{" "}
          {dayLabel(new Date(Date.parse(report.to) - 1).toISOString())}
        </div>
      )}

      {rangeProblem ? null : failed && !report ? (
        <div className={styles.warn} role="alert" data-testid="report-failed">
          {t("home.reportFailed")}
        </div>
      ) : (
        <>
          {/* 1. عملت كام؟ */}
          <section className={styles.qcard}>
            <h3 className={styles.qtitle}>💵 بعت بكام؟</h3>
            <b className={styles.qbig} data-testid="report-sales">
              {loading && !report ? (
                <Skeleton width={110} height={34} />
              ) : (
                money(sales?.revenuePiasters)
              )}
            </b>
            <small className={styles.qsub}>
              {sales?.count ?? 0} عملية بيع · بعد المرتجعات
            </small>
            {(sales?.serviceSalesPiasters ?? 0) > 0 && (
              <small className={styles.qsub} data-testid="report-service-sales">
                منها خدمات بـ {money(sales?.serviceSalesPiasters)}: مكسبك منها
                العمولة بس
              </small>
            )}
          </section>

          {/* 2. كسبت كام؟ */}
          <section className={`${styles.qcard} ${styles.qgood}`}>
            <h3 className={styles.qtitle}>📈 كسبت كام؟</h3>
            <b className={styles.qbig} data-testid="report-profit">
              {money(profit)}
            </b>
            <small className={styles.qsub}>
              {sales && sales.unknownCostCount > 0
                ? t("home.unknownCost", { count: sales.unknownCostCount })
                : "الفرق بين البيع وتمن البضاعة اللي اتباعت"}
            </small>
            <div className={styles.qlines}>
              <div className={styles.line}>
                <span>تمن البضاعة اللي اتباعت</span>
                <b data-testid="report-cogs">{money(sales?.cogsPiasters)}</b>
              </div>
              <div className={styles.line}>
                <span>💰 اللي فاضل بعد المصروفات والتالف</span>
                <b
                  data-testid="report-left"
                  className={left !== null && left < 0 ? styles.redText : ""}
                >
                  {money(left)}
                </b>
              </div>
            </div>
          </section>

          {/* 2b. The full account of the period: actual vs estimated, said in plain words */}
          {report?.profit && (
            <section className={styles.qcard} data-testid="report-net">
              <h3 className={styles.qtitle}>
                🧾 الحساب الكامل للفترة{" "}
                <small data-testid="report-net-status">
                  {report.profit.status === "actual"
                    ? "(أرقام فعلية)"
                    : report.profit.status === "estimated"
                      ? "(ربح تقديري)"
                      : "(بيانات غير مكتملة)"}
                </small>
              </h3>
              <b className={styles.qbig} data-testid="report-net-profit">
                {money(
                  report.profit.netProfitPiasters ??
                    report.profit.estimatedNetProfitPiasters,
                )}
              </b>
              <small className={styles.qsub}>
                صافي المكسب = مكسب البضاعة + عمولات الخدمات − مصاريف المحل −
                التالف والعجز
              </small>
              <div className={styles.qlines}>
                <div className={styles.line}>
                  <span>مبيعات البضاعة</span>
                  <b>{money(report.profit.productSalesPiasters)}</b>
                </div>
                {report.profit.discoveredSalesPiasters > 0 && (
                  <div className={styles.line}>
                    <span>منها اتباع ومتسجلش (من الجرد)</span>
                    <b>{money(report.profit.discoveredSalesPiasters)}</b>
                  </div>
                )}
                <div className={styles.line}>
                  <span>
                    مكسب البضاعة{" "}
                    {report.profit.grossProfitPiasters === null &&
                    report.profit.estimateMarginPercent !== null
                      ? `(تقديري بهامش ${report.profit.estimateMarginPercent}%)`
                      : ""}
                  </span>
                  <b>
                    {money(
                      report.profit.grossProfitPiasters ??
                        report.profit.estimatedGrossProfitPiasters,
                    )}
                  </b>
                </div>
                <div className={styles.line}>
                  <span>📲 عمولات الخدمات</span>
                  <b data-testid="report-commissions">
                    {money(report.profit.serviceCommissionsPiasters)}
                  </b>
                </div>
                <div className={styles.line}>
                  <span>💸 مصاريف المحل</span>
                  <b>
                    {report.profit.operatingExpensesPiasters > 0 ? "−" : ""}
                    {money(report.profit.operatingExpensesPiasters)}
                  </b>
                </div>
                <div className={styles.line}>
                  <span>🗑️ تالف وعجز جرد</span>
                  <b>
                    {report.profit.inventoryLossesPiasters > 0 ? "−" : ""}
                    {money(report.profit.inventoryLossesPiasters)}
                  </b>
                </div>
                <div className={styles.line}>
                  <span>👤 سحبت لنفسك (مش من المصاريف)</span>
                  <b>{money(report.profit.ownerWithdrawalsPiasters)}</b>
                </div>
                {report.inventoryValue && (
                  <div className={styles.line}>
                    <span>📦 قيمة البضاعة عندك دلوقتي (بالتكلفة / بالبيع)</span>
                    <b data-testid="report-stock-value">
                      {money(report.inventoryValue.costPiasters)} /{" "}
                      {money(report.inventoryValue.sellPiasters)}
                    </b>
                  </div>
                )}
              </div>
              {report.profit.notes.length > 0 && (
                <ul className={styles.qsub} data-testid="report-net-notes">
                  {report.profit.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 3. صرفت كام؟ */}
          <section className={styles.qcard}>
            <h3 className={styles.qtitle}>💸 صرفت كام؟</h3>
            <b className={styles.qbig} data-testid="report-expenses">
              {money(expenses)}
            </b>
            <small className={styles.qsub}>
              {report?.expenses.count ?? 0} مصروف
            </small>
            {expenseList && expenseList.length > 0 && (
              <div className={styles.qlines} data-testid="report-expense-list">
                {expenseList.map((e) => (
                  <div key={e.id} className={styles.line}>
                    <span>
                      {t(`pages.expenses.categories.${e.category}`) ||
                        e.category}
                      <small className={styles.muted}>
                        {" "}
                        {dayLabel(e.spent_at)}
                        {e.note ? ` · ${e.note}` : ""}
                      </small>
                    </span>
                    <b>{formatMoney(e.amount_piasters)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 4. دخل عندي بضاعة بكام؟ */}
          <section className={styles.qcard}>
            <h3 className={styles.qtitle}>📦 دخل عندك بضاعة بكام؟</h3>
            <b className={styles.qbig} data-testid="report-purchases">
              {money(report?.purchases.totalPiasters)}
            </b>
            <small className={styles.qsub}>
              {report?.purchases.count ?? 0} مرة دخلت بضاعة · بسعر الشراء، مش
              مصروف
            </small>
            <div className={styles.qlines} data-testid="report-additions">
              {moves === null ? (
                <Skeleton width={160} height={20} />
              ) : additions.length === 0 ? (
                <div className={styles.note}>مفيش بضاعة دخلت في الفترة دي</div>
              ) : (
                additions.map((m) => (
                  <div key={m.id} className={styles.line}>
                    <span>
                      {m.productName}
                      {m.flavor ? ` (${m.flavor})` : ""} ·{" "}
                      {m.unitMode === "weight"
                        ? `${m.quantityBase / 1000} كيلو`
                        : `${m.quantityBase}`}
                      <small className={styles.muted}>
                        {" "}
                        {dayLabel(m.createdAt)}
                        {m.expiryDate
                          ? ` · تنتهي ${m.expiryDate.slice(0, 10)}`
                          : ""}
                        {m.supplierName ? ` · ${m.supplierName}` : ""}
                      </small>
                    </span>
                    <b>
                      {m.costTotalMinor || m.costPricePiasters
                        ? formatMoney(
                            m.costTotalMinor || m.costPricePiasters || 0,
                          )
                        : "—"}
                    </b>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 5. في تالف قد إيه؟ */}
          <section className={`${styles.qcard} ${styles.qbad}`}>
            <h3 className={styles.qtitle}>🗑️ في تالف قد إيه؟</h3>
            <b className={styles.qbig} data-testid="report-losses">
              {money(losses)}
            </b>
            <small className={styles.qsub}>
              {report?.losses.count ?? 0} مرة · بسعر الشراء
            </small>
            {report && report.losses.recent.length > 0 && (
              <div className={styles.qlines} data-testid="home-losses">
                {report.losses.recent.map((l) => (
                  <div key={l.id} className={styles.line}>
                    <span>
                      {l.name} ·{" "}
                      {l.unit === "kg" || l.unit === "g"
                        ? `${l.quantityBase / 1000} كيلو`
                        : l.quantityBase}
                      <small className={styles.muted}>
                        {" "}
                        {WASTE_REASON_LABELS[l.reason as WasteReason] ??
                          l.reason}
                      </small>
                    </span>
                    <b>{money(l.costPiasters)}</b>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 6. إيه المنتجات المهمة؟ */}
          {report && report.topProducts.length > 0 && (
            <section className={styles.qcard}>
              <h3 className={styles.qtitle}>⭐ أكتر حاجات اتباعت</h3>
              <div className={styles.qlines} data-testid="report-top">
                {report.topProducts.map((p) => (
                  <div key={`${p.productId}-${p.name}`} className={styles.line}>
                    <span>{p.name}</span>
                    <b>{formatMoney(p.revenuePiasters)}</b>
                  </div>
                ))}
              </div>
              {report.byCategory.length > 1 && (
                <>
                  <div className={styles.lbl}>حسب القسم</div>
                  <div className={styles.qlines}>
                    {report.byCategory.map((c) => (
                      <div key={c.category} className={styles.line}>
                        <span>{c.category || "متفرقات"}</span>
                        <b>{formatMoney(c.revenuePiasters)}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* 7. بعت إزاي؟ — last */}
          <section className={styles.qcard}>
            <h3 className={styles.qtitle}>💳 بعت إزاي؟</h3>
            <div className={styles.qlines} data-testid="report-by-payment">
              <div className={styles.line}>
                <span>💵 كاش</span>
                <b>{money(pay?.cash)}</b>
              </div>
              <div className={styles.line}>
                <span>💳 محافظ وماكينات</span>
                <b>{pay ? formatMoney(pay.wallet + pay.card) : "—"}</b>
              </div>
              <div className={styles.line}>
                <span>🧾 آجل</span>
                <b>{money(pay?.debt)}</b>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default ReportsView;
