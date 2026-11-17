"use client";

/**
 * @file ReportsView.tsx
 * @description Reports (V19): the period's sales, profit after the cost of goods, expenses,
 * losses and what is left, how sales were paid, the best sellers and the day-by-day sales —
 * all from the server's Home report for the chosen period. A profit whose cost is not
 * recorded is shown as unknown, never estimated (ADR-0021).
 */

import React, { useEffect, useState } from "react";
import { Skeleton } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import type { ReportPeriod } from "@/schemas/report";
import { toCairoDateString } from "@/domain/time";
import styles from "./HomeView.module.css";

const PERIODS: Array<[ReportPeriod, string]> = [
  ["today", "النهارده"],
  ["yesterday", "امبارح"],
  ["week", "الأسبوع"],
  ["month", "الشهر"],
  ["year", "السنة"],
  ["custom", "فترة معينة"],
];

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));

export function ReportsView() {
  const [today] = useState(() => toCairoDateString(new Date()));
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<HomeReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new period starts a new load
    setLoading(true);
    fetchHomeReport(period, controller.signal, { from, to })
      .then((r) => {
        setReport(r);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, from, to]);

  const sales = report?.sales;
  const profit = sales?.grossProfitPiasters ?? null;
  const expenses = report?.expenses.totalPiasters ?? 0;
  const losses = report?.losses.costPiasters ?? 0;
  const left = profit === null ? null : profit - expenses - losses;
  const pay = report?.byPaymentMethod;
  const points = report?.series.points ?? [];
  const maxPoint = Math.max(1, ...points.map((p) => p.revenuePiasters));
  const money = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : formatMoney(v);

  return (
    <div className={styles.page} data-testid="page-reports" dir="rtl">
      <h2 className={styles.h2}>التقارير</h2>
      <div className={styles.chips} role="tablist">
        {PERIODS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={period === k}
            className={`${styles.chip} ${period === k ? styles.chipOn : ""}`}
            onClick={() => setPeriod(k)}
            data-testid={`report-period-${k}`}
          >
            {label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className={styles.two}>
          <label>
            <span className={styles.lbl}>من</span>
            <input
              type="date"
              className={styles.input}
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value || today)}
              data-testid="report-from"
            />
          </label>
          <label>
            <span className={styles.lbl}>لحد</span>
            <input
              type="date"
              className={styles.input}
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value || from)}
              data-testid="report-to"
            />
          </label>
        </div>
      )}
      {report?.from && (
        <div className={styles.note} data-testid="report-range">
          من {dayLabel(report.from)} لحد{" "}
          {dayLabel(new Date(Date.parse(report.to) - 1).toISOString())}
        </div>
      )}

      {failed && !report ? (
        <div className={styles.warn} role="alert">
          {t("home.reportFailed")}
        </div>
      ) : (
        <>
          <div className={styles.grid2}>
            <div className={styles.stat}>
              <small>💵 بعت</small>
              <b data-testid="report-sales">
                {loading && !report ? (
                  <Skeleton width={70} height={24} />
                ) : (
                  money(sales?.revenuePiasters)
                )}
              </b>
              <small>{sales?.count ?? 0} عملية</small>
            </div>
            <div className={`${styles.stat} ${styles.good}`}>
              <small>📈 ربحك</small>
              <b data-testid="report-profit">{money(profit)}</b>
              <small>
                {sales && sales.unknownCostCount > 0
                  ? t("home.unknownCost", { count: sales.unknownCostCount })
                  : "بعد تكلفة البضاعة"}
              </small>
            </div>
            <div className={styles.stat}>
              <small>💸 مصروفات</small>
              <b data-testid="report-expenses">{money(expenses)}</b>
              <small>{report?.expenses.count ?? 0} مصروف</small>
            </div>
            <div className={`${styles.stat} ${styles.bad}`}>
              <small>🗑️ تالف</small>
              <b data-testid="report-losses">{money(losses)}</b>
              <small>{report?.losses.count ?? 0} مرة</small>
            </div>
          </div>
          <div className={`${styles.stat} ${styles.good}`}>
            <small>💰 اللي فاضل بعد المصروفات والتالف</small>
            <b data-testid="report-left">{money(left)}</b>
          </div>

          <h3 className={styles.sech}>بعت إزاي؟</h3>
          <div className={styles.sumbox} data-testid="report-by-payment">
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

          {points.length > 1 && (
            <>
              <h3 className={styles.sech}>
                {report?.series.granularity === "hour"
                  ? "البيع على مدار اليوم"
                  : "البيع يوم بيوم"}
              </h3>
              <div className={styles.sumbox} data-testid="report-series">
                {points
                  .filter((p) => p.revenuePiasters > 0)
                  .map((p) => (
                    <div key={p.key} className={styles.barRow}>
                      <span className={styles.barKey}>
                        {report?.series.granularity === "hour"
                          ? `${p.key}:00`
                          : dayLabel(`${p.key}T12:00:00Z`)}
                      </span>
                      <span className={styles.barTrack}>
                        <i
                          style={{
                            width: `${Math.max(4, (p.revenuePiasters / maxPoint) * 100)}%`,
                          }}
                        />
                      </span>
                      <b>{formatMoney(p.revenuePiasters)}</b>
                    </div>
                  ))}
              </div>
            </>
          )}

          {report && report.topProducts.length > 0 && (
            <>
              <h3 className={styles.sech}>أكتر حاجات اتباعت</h3>
              <div className={styles.sumbox} data-testid="report-top">
                {report.topProducts.map((p) => (
                  <div key={`${p.productId}-${p.name}`} className={styles.line}>
                    <span>{p.name}</span>
                    <b>{formatMoney(p.revenuePiasters)}</b>
                  </div>
                ))}
              </div>
            </>
          )}

          {report && report.byCategory.length > 0 && (
            <>
              <h3 className={styles.sech}>البيع حسب القسم</h3>
              <div className={styles.sumbox}>
                {report.byCategory.map((c) => (
                  <div key={c.category} className={styles.line}>
                    <span>{c.category || "متفرقات"}</span>
                    <b>{formatMoney(c.revenuePiasters)}</b>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default ReportsView;
