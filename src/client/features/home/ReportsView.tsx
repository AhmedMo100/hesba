"use client";

/**
 * @file ReportsView.tsx
 * @description Reports, in the order a shop owner asks: how much did I sell, how much did I
 * earn, how much did I spend, how much stock came in, how much was lost, what sells best —
 * and how it was paid, last. All from the server's report for the chosen period. A profit
 * whose cost is not recorded is shown as unknown, never estimated (ADR-0021). Reports only
 * show: cancelling a stock entry is done from «دخلت بضاعة».
 */

import React, { useEffect, useState } from "react";
import { Skeleton } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import { apiGet } from "@/client/shared/api/read-cache";
import { WASTE_REASON_LABELS, type WasteReason } from "@/schemas/inventory";
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
  const [today] = useState(() => toCairoDateString(new Date()));
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<HomeReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // The stock that came in (the old stock screen's additions log), for the same period.
  const [moves, setMoves] = useState<StockMove[] | null>(null);
  // The period's expenses, one by one (the expenses screen shows today only).
  const [expenseList, setExpenseList] = useState<ExpenseRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet("/api/stock?view=all")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMoves(d?.movements ?? []))
      .catch(() => alive && setMoves([]));
    return () => {
      alive = false;
    };
  }, []);

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
