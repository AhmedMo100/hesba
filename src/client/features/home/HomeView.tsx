"use client";

/**
 * @file HomeView.tsx
 * @description The home dashboard: today's sales, stock and expense summaries and shortcuts.
 *
 * @remarks
 * - "الجرد" (inventory) reads `/api/stock?view=all`.
 * - "التقرير" (report) reads `/api/reports/home?period=…` (ADR-0021): every financial figure —
 *   revenue, cost of goods sold, gross profit, expenses, purchases, the chart, top products,
 *   categories, activity — is computed on the server from recorded data. This screen does no
 *   financial arithmetic; a cost or profit the server reports as unknown is shown as "—",
 *   never estimated (audit QA-06 / QA-07).
 * A failed request leaves that section empty.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Seg, SearchBox, Icon, Empty } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import {
  fetchHomeReport,
  type HomeReport,
  type ReportPeriod,
} from "@/client/shared/api/reports";
import { normalizeArabic } from "@/domain/normalize";
import type { StockInventoryItem } from "@/client/shared/store-items";
import styles from "./HomeView.module.css";

type PeriodKey = ReportPeriod;

/** Money, or "—" when the server could not determine it from recorded data. */
function moneyOrUnknown(piasters: number | null): string {
  return piasters === null ? "—" : formatMoney(piasters);
}

function formatQtyText(
  unitMode: "piece" | "weight",
  qtyBase: number,
  packQty = 1,
  unit = "قطعة",
  packName?: string,
): string {
  if (unitMode === "weight") {
    const kg = qtyBase / 1000;
    return `${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
  }
  if (packQty > 1 && qtyBase >= packQty) {
    const packs = Math.floor(qtyBase / packQty);
    const rem = qtyBase % packQty;
    const pName = packName || "كرتونة";
    if (rem === 0) {
      return `${packs} ${pName}`;
    }
    return `${packs} ${pName} و ${rem} ${unit}`;
  }
  return `${qtyBase} ${unit}`;
}

export function HomeView() {
  const [tab, setTab] = useState<"rep" | "inv">("inv");
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [query, setQuery] = useState("");
  const [showMoreTop, setShowMoreTop] = useState(false);

  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [loadedReport, setReport] = useState<HomeReport | null>(null);
  // Only the chosen period's report is shown; another period's is never shown meanwhile.
  const report = loadedReport?.period === period ? loadedReport : null;
  const [reportFailed, setReportFailed] = useState(false);
  const [reportAttempt, setReportAttempt] = useState(0);

  // The report of the chosen period, from the server (ADR-0021). A failed read (offline, or a
  // request cut off by a page reload) is retried once and can be retried by hand; until a
  // report arrives the figures show "—", never 0.
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = (retriesLeft: number) => {
      fetchHomeReport(period, controller.signal)
        .then((r) => {
          setReport(r);
          setReportFailed(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (retriesLeft > 0) {
            retry = setTimeout(() => load(retriesLeft - 1), 1500);
          } else {
            setReportFailed(true);
          }
        });
    };
    const reload = () => load(1);
    reload();
    window.addEventListener("hesba_stock_updated", reload);
    window.addEventListener("hesba_sales_config_updated", reload);
    window.addEventListener("online", reload);
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
      window.removeEventListener("hesba_stock_updated", reload);
      window.removeEventListener("hesba_sales_config_updated", reload);
      window.removeEventListener("online", reload);
    };
  }, [period, reportAttempt]);

  // Load Inventory
  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      try {
        const stockRes = await fetch("/api/stock?view=all").catch(() => null);
        if (stockRes && stockRes.ok && !ignore) {
          const sData = await stockRes.json();
          if (sData?.inventory && Array.isArray(sData.inventory)) {
            setInventory(sData.inventory);
          }
        }
      } catch {}
    };

    void fetchData();

    const handleUpdates = () => void fetchData();
    window.addEventListener("hesba_stock_updated", handleUpdates);
    window.addEventListener("hesba_sales_config_updated", handleUpdates);
    return () => {
      ignore = true;
      window.removeEventListener("hesba_stock_updated", handleUpdates);
      window.removeEventListener("hesba_sales_config_updated", handleUpdates);
    };
  }, []);

  // Inventory Calculations for "الجرد" Tab
  const inventoryRows = useMemo(() => {
    return inventory.map((item) => {
      const factor = item.unitMode === "weight" ? 1000 : 1;
      const q = item.currentStockBase / factor;
      const buyPrice = item.buyPricePiasters || 0;
      const sellPrice = item.sellPricePiasters || 0;

      // Purchase value & Sell value in Piasters
      const costPiasters = Math.round(q * buyPrice);
      const valPiasters = Math.round(q * sellPrice);

      return {
        ...item,
        costPiasters,
        valPiasters,
      };
    });
  }, [inventory]);

  const filteredInventory = useMemo(() => {
    const qNorm = normalizeArabic(query.trim());
    if (!qNorm) return inventoryRows;
    return inventoryRows.filter((item) =>
      normalizeArabic(item.productName).includes(qNorm),
    );
  }, [inventoryRows, query]);

  const totalCostPiasters = useMemo(() => {
    return inventoryRows.reduce((sum, item) => sum + item.costPiasters, 0);
  }, [inventoryRows]);

  const totalSellPiasters = useMemo(() => {
    return inventoryRows.reduce((sum, item) => sum + item.valPiasters, 0);
  }, [inventoryRows]);

  const expectedProfitPiasters = totalSellPiasters - totalCostPiasters;

  const countOut = useMemo(
    () => inventory.filter((i) => i.status === "out").length,
    [inventory],
  );
  const countLow = useMemo(
    () => inventory.filter((i) => i.status === "low").length,
    [inventory],
  );

  // Report values — all computed by the server (ADR-0021); only labels are built here.
  // No report yet (loading, offline or failed) → "—", never a misleading 0 (QA-06).
  const totalRevenuePiasters = report?.sales.revenuePiasters ?? null;
  const saleCount = report?.sales.count ?? 0;
  const totalCogsPiasters = report?.sales.cogsPiasters ?? null;
  const grossProfitPiasters = report?.sales.grossProfitPiasters ?? null;
  const unknownCostCount = report?.sales.unknownCostCount ?? 0;
  const totalExpensesPiasters = report?.expenses.totalPiasters ?? null;
  const totalPurchasesPiasters = report?.purchases.totalPiasters ?? null;
  const purchasesUnknownCount = report?.purchases.unknownCostCount ?? 0;

  const chartSeries = useMemo(() => {
    if (!report || report.sales.count === 0) return [];
    return report.series.points.map((p) => {
      let label = p.key;
      if (report.series.granularity === "hour") {
        const h = Number(p.key);
        label = `${h % 12 || 12} ${h >= 12 ? "م" : "ص"}`;
      } else {
        const [, m, d] = p.key.split("-");
        label = `${Number(d)}/${Number(m)}`;
      }
      return { k: p.key, label, rev: p.revenuePiasters };
    });
  }, [report]);

  const topProducts = useMemo(
    () =>
      (report?.topProducts ?? []).map((p) => ({
        key: p.productId ?? p.name,
        name: p.name,
        rev: p.revenuePiasters,
        profit: p.grossProfitPiasters,
      })),
    [report],
  );

  const salesByCat = useMemo(
    () =>
      (report?.byCategory ?? []).map((c) => ({
        cat: c.category,
        rev: c.revenuePiasters,
        profit: c.grossProfitPiasters,
      })),
    [report],
  );

  const timelineEvents = useMemo(
    () =>
      (report?.activity ?? []).map((a) => ({
        ts: Date.parse(a.at),
        type: a.kind === "sale" ? ("sale" as const) : ("exp" as const),
        title:
          a.kind === "sale"
            ? t("home.activitySale", { id: a.id.slice(0, 5) })
            : t("home.activityExpense", { category: a.label }),
        meta: a.kind === "sale" ? a.label : a.note || undefined,
        amountPiasters: a.amountPiasters,
      })),
    [report],
  );

  // Export Inventory CSV matching Image 1
  const exportToExcel = () => {
    const headers = [
      "المنتج",
      "القسم",
      "الكمية",
      "قيمة الشراء (ج.م)",
      "قيمة البيع (ج.م)",
    ];
    const rowsCsv = filteredInventory.map((item) => {
      const qText =
        item.currentStockBase <= 0
          ? "خلصان"
          : formatQtyText(
              item.unitMode,
              item.currentStockBase,
              item.packQty,
              item.unit,
              item.packName || undefined,
            );
      const buyVal = (item.costPiasters / 100).toFixed(2);
      const sellVal = (item.valPiasters / 100).toFixed(2);

      return [
        `"${item.productName.replace(/"/g, '""')}"`,
        `"${(item.category || "متفرقات").replace(/"/g, '""')}"`,
        `"${qText.replace(/"/g, '""')}"`,
        buyVal,
        sellVal,
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rowsCsv].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const todayStr = new Date().toISOString().split("T")[0];
    link.setAttribute("href", url);
    link.setAttribute("download", `jard-${todayStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Cairo date label for banner
  const todayDateLabel = useMemo(() => {
    const now = new Date();
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);
  }, []);

  return (
    <div className={styles.page} data-testid="page-home" dir="rtl">
      {/* Top Segmented Controls: التقرير vs الجرد */}
      <Seg
        value={tab}
        onChange={setTab}
        options={[
          ["rep", "التقرير", "chart"],
          ["inv", "الجرد", "layers"],
        ]}
      />

      {/* ===================== TAB: الجرد (Inventory Valuation) ===================== */}
      {tab === "inv" ? (
        <>
          {/* Big Green Banner & Summary Stats matching Image 1 */}
          <div className={styles.kpis}>
            <div className={`${styles.kpi} ${styles.kpiBig}`}>
              <small>قيمة المخزون بسعر الشراء — جرد {todayDateLabel}</small>
              <b>{formatMoney(totalCostPiasters)}</b>
              <em>
                بسعر البيع {formatMoney(totalSellPiasters)} · ربح متوقع{" "}
                {formatMoney(expectedProfitPiasters)}
              </em>
            </div>

            <div className={styles.kpi}>
              <small>عدد الأصناف</small>
              <b>{inventory.length}</b>
            </div>

            <div className={`${styles.kpi} ${styles.kpiNeg}`}>
              <small>خلصان</small>
              <b>{countOut}</b>
            </div>

            <div className={styles.kpi}>
              <small>قرب يخلص</small>
              <b>{countLow}</b>
            </div>
          </div>

          {/* SearchBox & Export Button Toolbar */}
          <div className={styles.invBar}>
            <div className={styles.invSearch}>
              <SearchBox
                value={query}
                onChange={setQuery}
                placeholder="دوّر في الجرد"
              />
            </div>
            <button
              type="button"
              className={styles.exportBtn}
              onClick={exportToExcel}
              title="تصدير بيانات الجرد إلى Excel"
            >
              <Icon n="download" s={15} />
              <span>تصدير Excel</span>
            </button>
          </div>

          {/* Inventory Valuation Table matching Image 1, 2, 3 */}
          <div className={styles.tblCard}>
            <div className={styles.tblW}>
              <table className={styles.tbl}>
                <thead>
                  <tr>
                    <th>المنتج</th>
                    <th>الكمية</th>
                    <th>قيمة الشراء</th>
                    <th>قيمة البيع</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ textAlign: "center", padding: "24px" }}
                      >
                        <Empty
                          icon="search"
                          title="مفيش أصناف مطابقة"
                          sub="تأكد من كتابة اسم المنتج بشكل صحيح"
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredInventory.map((item) => {
                      const isOut = item.status === "out";
                      const isLow = item.status === "low";
                      return (
                        <tr key={item.productId}>
                          <td>
                            <span
                              className={`${styles.dot} ${
                                isOut
                                  ? styles.dotRed
                                  : isLow
                                    ? styles.dotYellow
                                    : styles.dotGreen
                              }`}
                            />
                            <span>{item.productName}</span>
                          </td>
                          <td>
                            {isOut ? (
                              <span className={styles.tagOut}>خلصان</span>
                            ) : (
                              formatQtyText(
                                item.unitMode,
                                item.currentStockBase,
                                item.packQty,
                                item.unit,
                                item.packName || undefined,
                              )
                            )}
                          </td>
                          <td>
                            {((item.costPiasters || 0) / 100).toLocaleString(
                              "en-US",
                              { maximumFractionDigits: 2 },
                            )}
                          </td>
                          <td>
                            {((item.valPiasters || 0) / 100).toLocaleString(
                              "en-US",
                              { maximumFractionDigits: 2 },
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {filteredInventory.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>الإجمالي</td>
                      <td />
                      <td>
                        {(totalCostPiasters / 100).toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                      <td>
                        {(totalSellPiasters / 100).toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      ) : (
        /* ===================== TAB: التقرير (Sales & Store Report) ===================== */
        <>
          {/* Period Selector Chips */}
          <div className={styles.periodBar} role="tablist">
            {(
              [
                ["today", "النهارده"],
                ["yesterday", "امبارح"],
                ["week", "الأسبوع"],
                ["month", "الشهر"],
                ["all", "الكل"],
              ] as const
            ).map(([pKey, label]) => (
              <button
                type="button"
                key={pKey}
                role="tab"
                aria-selected={period === pKey}
                className={`${styles.chip} ${period === pKey ? styles.chipOn : ""}`}
                onClick={() => setPeriod(pKey)}
              >
                {label}
              </button>
            ))}
          </div>

          {reportFailed && (
            <div className={styles.reportError} role="alert">
              <span>{t("home.reportFailed")}</span>
              <button
                type="button"
                onClick={() => {
                  setReportFailed(false);
                  setReportAttempt((n) => n + 1);
                }}
              >
                {t("home.reportRetry")}
              </button>
            </div>
          )}

          {/* Report KPI Grid matching Image 4 */}
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <small>المبيعات</small>
              <b data-testid="home-revenue">
                {moneyOrUnknown(totalRevenuePiasters)}
              </b>
              <em>{saleCount} بيعة</em>
            </div>

            <div className={styles.kpi}>
              <small>مجمل الربح</small>
              <b data-testid="home-profit">
                {moneyOrUnknown(grossProfitPiasters)}
              </b>
              <em>
                {unknownCostCount > 0
                  ? t("home.unknownCost", { count: unknownCostCount })
                  : "المبيعات − تكلفة البضاعة"}
              </em>
            </div>

            <div className={styles.kpi}>
              <small>تكلفة البضاعة المباعة</small>
              <b data-testid="home-cogs">{moneyOrUnknown(totalCogsPiasters)}</b>
            </div>

            <div className={`${styles.kpi} ${styles.kpiNeg}`}>
              <small>المصروفات</small>
              <b data-testid="home-expenses">
                {moneyOrUnknown(totalExpensesPiasters)}
              </b>
            </div>

            <div
              className={styles.kpi}
              style={{ gridColumn: "1 / -1", width: "100%" }}
            >
              <small>مشتريات دخلت المخزن</small>
              <b data-testid="home-purchases">
                {moneyOrUnknown(totalPurchasesPiasters)}
              </b>
              <em>
                مش بتتخصم من الربح
                {purchasesUnknownCount > 0 &&
                  ` · ${t("home.purchasesUnknown", { count: purchasesUnknownCount })}`}
              </em>
            </div>
          </div>

          {/* Sales Chart Section */}
          <section className={styles.sectionCard}>
            <h2 className={styles.secTitle}>المبيعات</h2>
            {(totalRevenuePiasters ?? 0) > 0 ? (
              <div className={styles.chartContainer}>
                <svg
                  viewBox="0 0 600 180"
                  preserveAspectRatio="none"
                  className={styles.chartSvg}
                  role="img"
                  aria-label="مبيعات الفترة"
                >
                  {[0.25, 0.5, 0.75, 1].map((f) => (
                    <line
                      key={f}
                      x1={0}
                      x2={600}
                      y1={150 - 150 * f}
                      y2={150 - 150 * f}
                      className={styles.gl}
                    />
                  ))}
                  {chartSeries.map((s, i) => {
                    const maxVal = Math.max(
                      1,
                      ...chartSeries.map((it) => it.rev),
                    );
                    const bw = 580 / Math.max(1, chartSeries.length);
                    const h = Math.max(4, (s.rev / maxVal) * 130);
                    const x = i * bw + bw * 0.15;
                    return (
                      <g key={s.k}>
                        <rect
                          x={x}
                          y={150 - h}
                          width={bw * 0.7}
                          height={h}
                          rx={3}
                          className={styles.bar}
                        />
                        <text
                          x={i * bw + bw / 2}
                          y={170}
                          textAnchor="middle"
                          className={styles.ax}
                        >
                          {s.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <Empty icon="chart" title="مفيش مبيعات في الفترة دي" />
            )}
          </section>

          {/* Top Products & By Category matching Image 5 */}
          <div className={styles.twoCols}>
            {/* Top Products */}
            <section className={styles.sectionCard}>
              <h2 className={styles.secTitle}>الأكتر مبيعاً</h2>
              {topProducts.length === 0 ? (
                <div className={styles.mutedText}>—</div>
              ) : (
                <div className={styles.topList}>
                  {topProducts
                    .slice(0, showMoreTop ? 15 : 5)
                    .map((item, idx) => {
                      const maxRev = topProducts[0]?.rev || 1;
                      const pct = Math.round((item.rev / maxRev) * 100);
                      return (
                        <div key={item.key} className={styles.topItem}>
                          <span className={styles.topRank}>{idx + 1}</span>
                          <div className={styles.topNameGroup}>
                            <b>{item.name}</b>
                            <i
                              className={styles.topBar}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className={styles.topValues}>
                            <b>{formatMoney(item.rev)}</b>
                            <small>ربح {moneyOrUnknown(item.profit)}</small>
                          </div>
                        </div>
                      );
                    })}
                  {topProducts.length > 5 && (
                    <button
                      type="button"
                      className={styles.moreBtn}
                      onClick={() => setShowMoreTop(!showMoreTop)}
                    >
                      {showMoreTop ? "عرض أقل" : "المزيد"}
                    </button>
                  )}
                </div>
              )}
            </section>

            {/* By Category */}
            <section className={styles.sectionCard}>
              <h2 className={styles.secTitle}>حسب القسم</h2>
              {salesByCat.length === 0 ? (
                <div className={styles.mutedText}>—</div>
              ) : (
                <div className={styles.topList}>
                  {salesByCat.map((cat) => (
                    <div key={cat.cat} className={styles.catItem}>
                      <span>{cat.cat}</span>
                      <div className={styles.catValues}>
                        <b>{formatMoney(cat.rev)}</b>
                        <small>ربح {moneyOrUnknown(cat.profit)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Store Activity Timeline matching Image 5 */}
          <section className={styles.sectionCard}>
            <h2 className={styles.secTitle}>كل اللي حصل في المحل</h2>
            {timelineEvents.length === 0 ? (
              <div className={styles.mutedText}>لا يوجد نشاط</div>
            ) : (
              <div className={styles.topList}>
                {timelineEvents.slice(0, 30).map((ev, i) => (
                  <div key={i} className={styles.timelineItem}>
                    <span
                      className={`${styles.tlDot} ${
                        ev.type === "sale" ? styles.tlDotSale : styles.tlDotExp
                      }`}
                    />
                    <div className={styles.tlBody}>
                      <b>{ev.title}</b>
                      <small>
                        {new Date(ev.ts).toLocaleTimeString("ar-EG", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {ev.meta ? ` · ${ev.meta}` : ""}
                      </small>
                    </div>
                    <span
                      className={`${styles.tlAmt} ${
                        ev.amountPiasters > 0
                          ? styles.tlAmtPos
                          : styles.tlAmtNeg
                      }`}
                    >
                      {ev.amountPiasters > 0 ? "+" : "−"}
                      {formatMoney(Math.abs(ev.amountPiasters))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default HomeView;
