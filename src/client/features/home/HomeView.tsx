"use client";

/**
 * @file HomeView.tsx
 * @description The home dashboard: today's sales, stock and expense summaries and shortcuts.
 *
 * @remarks
 * Data comes from the server only (`/api/stock?view=all`, `/api/sales`,
 * `/api/expenses?period=all`); it does not read the sales kept in `localStorage` by the sales
 * screen. A failed request leaves that section empty.
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Seg, SearchBox, Icon, Empty } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { normalizeArabic } from "@/domain/normalize";
import type { StockInventoryItem } from "@/client/shared/store-items";
import styles from "./HomeView.module.css";

interface SaleTransactionItem {
  productName: string;
  categoryName?: string;
  quantityBase: number;
  unitMode: string;
  unitPriceMinor: number;
  totalMinor: number;
}

interface SaleRecord {
  id: string;
  totalPiasters: number;
  paymentMethod: string;
  createdAt: string;
  items: SaleTransactionItem[];
}

interface ExpenseRecord {
  id: string;
  amountPiasters: number;
  category: string;
  notes?: string;
  createdAt: string;
}

type PeriodKey = "today" | "yesterday" | "week" | "month" | "all";

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
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);

  // Load Inventory, Sales and Expenses
  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      try {
        const [stockRes, salesRes, expRes] = await Promise.all([
          fetch("/api/stock?view=all").catch(() => null),
          fetch("/api/sales").catch(() => null),
          fetch("/api/expenses?period=all").catch(() => null),
        ]);

        if (stockRes && stockRes.ok && !ignore) {
          const sData = await stockRes.json();
          if (sData?.inventory && Array.isArray(sData.inventory)) {
            setInventory(sData.inventory);
          }
        }

        if (salesRes && salesRes.ok && !ignore) {
          const slData = await salesRes.json();
          if (slData?.sales && Array.isArray(slData.sales)) {
            setSales(slData.sales);
          }
        }

        if (expRes && expRes.ok && !ignore) {
          const eData = await expRes.json();
          if (eData?.expenses && Array.isArray(eData.expenses)) {
            setExpenses(eData.expenses);
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

  // Period Date Range Helper
  const isDateInPeriod = useCallback((dateStr: string, p: PeriodKey) => {
    const d = new Date(dateStr);
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).getTime();
    const t = d.getTime();

    if (p === "today") {
      return t >= todayStart;
    }
    if (p === "yesterday") {
      const yStart = todayStart - 86400000;
      return t >= yStart && t < todayStart;
    }
    if (p === "week") {
      return t >= todayStart - 7 * 86400000;
    }
    if (p === "month") {
      return t >= todayStart - 30 * 86400000;
    }
    return true; // "all"
  }, []);

  // Filtered Sales & Expenses for "التقرير" Tab
  const periodSales = useMemo(() => {
    return sales.filter((s) => isDateInPeriod(s.createdAt, period));
  }, [sales, period, isDateInPeriod]);

  const periodExpenses = useMemo(() => {
    return expenses.filter((e) => isDateInPeriod(e.createdAt, period));
  }, [expenses, period, isDateInPeriod]);

  // Report Metrics
  const totalRevenuePiasters = useMemo(() => {
    return periodSales.reduce((sum, s) => sum + (s.totalPiasters || 0), 0);
  }, [periodSales]);

  // COGS estimate: calculate cost from items or default ~75%
  const totalCogsPiasters = useMemo(() => {
    let cogs = 0;
    for (const s of periodSales) {
      if (s.items && s.items.length > 0) {
        for (const it of s.items) {
          const invMatch = inventory.find(
            (inv) => inv.productName === it.productName,
          );
          if (invMatch && invMatch.buyPricePiasters) {
            const factor = it.unitMode === "weight" ? 1000 : 1;
            cogs += Math.round(
              (it.quantityBase / factor) * invMatch.buyPricePiasters,
            );
          } else {
            cogs += Math.round((it.totalMinor || 0) * 0.75);
          }
        }
      } else {
        cogs += Math.round((s.totalPiasters || 0) * 0.75);
      }
    }
    return cogs;
  }, [periodSales, inventory]);

  const grossProfitPiasters = totalRevenuePiasters - totalCogsPiasters;

  const totalExpensesPiasters = useMemo(() => {
    return periodExpenses.reduce((sum, e) => sum + (e.amountPiasters || 0), 0);
  }, [periodExpenses]);

  // Purchases added to warehouse during period (from batch creations)
  const totalPurchasesPiasters = useMemo(() => {
    let total = 0;
    for (const inv of inventory) {
      if (inv.batches) {
        for (const b of inv.batches) {
          const bDate = b.receivedAt || new Date().toISOString();
          if (isDateInPeriod(bDate, period)) {
            const factor = inv.unitMode === "weight" ? 1000 : 1;
            total += Math.round(
              (b.remainingQty / factor) * (b.costPricePiasters || 0),
            );
          }
        }
      }
    }
    return total;
  }, [inventory, period, isDateInPeriod]);

  // Hourly or Daily Bar Series for Chart
  const chartSeries = useMemo(() => {
    if (periodSales.length === 0) return [];

    if (period === "today" || period === "yesterday") {
      // 24 Hours series
      const hoursMap: Record<number, { rev: number; gross: number }> = {};
      for (let h = 8; h <= 23; h++) {
        hoursMap[h] = { rev: 0, gross: 0 };
      }

      for (const s of periodSales) {
        const h = new Date(s.createdAt).getHours();
        if (!hoursMap[h]) hoursMap[h] = { rev: 0, gross: 0 };
        hoursMap[h].rev += s.totalPiasters;
        hoursMap[h].gross += Math.round(s.totalPiasters * 0.25);
      }

      return Object.entries(hoursMap).map(([hStr, data]) => {
        const h = parseInt(hStr, 10);
        const label = `${h % 12 || 12} ${h >= 12 ? "م" : "ص"}`;
        return {
          k: hStr,
          label,
          rev: data.rev,
          gross: data.gross,
        };
      });
    }

    // Days series for week / month
    const daysMap: Record<
      string,
      { rev: number; gross: number; label: string }
    > = {};
    for (const s of periodSales) {
      const d = new Date(s.createdAt);
      const key = d.toLocaleDateString("en-CA");
      const label = `${d.getDate()}/${d.getMonth() + 1}`;
      if (!daysMap[key]) daysMap[key] = { rev: 0, gross: 0, label };
      daysMap[key].rev += s.totalPiasters;
      daysMap[key].gross += Math.round(s.totalPiasters * 0.25);
    }

    return Object.entries(daysMap).map(([k, d]) => ({
      k,
      label: d.label,
      rev: d.rev,
      gross: d.gross,
    }));
  }, [periodSales, period]);

  // Top Selling Products
  const topProducts = useMemo(() => {
    const map: Record<
      string,
      { name: string; rev: number; profit: number; qty: number }
    > = {};

    for (const s of periodSales) {
      if (s.items && s.items.length > 0) {
        for (const it of s.items) {
          const key = it.productName;
          if (!map[key]) {
            map[key] = { name: key, rev: 0, profit: 0, qty: 0 };
          }
          map[key].rev += it.totalMinor;
          map[key].qty += it.quantityBase;
          map[key].profit += Math.round(it.totalMinor * 0.25);
        }
      }
    }

    return Object.values(map).sort((a, b) => b.rev - a.rev);
  }, [periodSales]);

  // Sales by Category
  const salesByCat = useMemo(() => {
    const map: Record<string, { rev: number; profit: number }> = {};
    for (const s of periodSales) {
      if (s.items && s.items.length > 0) {
        for (const it of s.items) {
          const cat = it.categoryName || "متفرقات";
          if (!map[cat]) map[cat] = { rev: 0, profit: 0 };
          map[cat].rev += it.totalMinor;
          map[cat].profit += Math.round(it.totalMinor * 0.25);
        }
      }
    }
    return Object.entries(map)
      .map(([cat, val]) => ({ cat, ...val }))
      .sort((a, b) => b.rev - a.rev);
  }, [periodSales]);

  // Activity Timeline (مبيعات ومصروفات)
  const timelineEvents = useMemo(() => {
    const list: Array<{
      ts: number;
      type: "sale" | "exp";
      title: string;
      meta?: string;
      amountPiasters: number;
    }> = [];

    for (const s of periodSales) {
      list.push({
        ts: new Date(s.createdAt).getTime(),
        type: "sale",
        title: `عملية بيع #${s.id.slice(0, 5)}`,
        meta: s.items?.map((it) => it.productName).join(" · "),
        amountPiasters: s.totalPiasters,
      });
    }

    for (const e of periodExpenses) {
      list.push({
        ts: new Date(e.createdAt).getTime(),
        type: "exp",
        title: `مصروف: ${e.category}`,
        meta: e.notes || undefined,
        amountPiasters: -e.amountPiasters,
      });
    }

    return list.sort((a, b) => b.ts - a.ts);
  }, [periodSales, periodExpenses]);

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

          {/* Report KPI Grid matching Image 4 */}
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <small>المبيعات</small>
              <b>{formatMoney(totalRevenuePiasters)}</b>
              <em>{periodSales.length} بيعة</em>
            </div>

            <div className={styles.kpi}>
              <small>مجمل الربح</small>
              <b>{formatMoney(grossProfitPiasters)}</b>
              <em>المبيعات − تكلفة البضاعة</em>
            </div>

            <div className={styles.kpi}>
              <small>تكلفة البضاعة المباعة</small>
              <b>{formatMoney(totalCogsPiasters)}</b>
            </div>

            <div className={`${styles.kpi} ${styles.kpiNeg}`}>
              <small>المصروفات</small>
              <b>{formatMoney(totalExpensesPiasters)}</b>
            </div>

            <div
              className={styles.kpi}
              style={{ gridColumn: "1 / -1", width: "100%" }}
            >
              <small>مشتريات دخلت المخزن</small>
              <b>{formatMoney(totalPurchasesPiasters)}</b>
              <em>مش بتتخصم من الربح</em>
            </div>
          </div>

          {/* Sales Chart Section */}
          <section className={styles.sectionCard}>
            <h2 className={styles.secTitle}>المبيعات</h2>
            {totalRevenuePiasters > 0 ? (
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
                        <div key={item.name} className={styles.topItem}>
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
                            <small>ربح {formatMoney(item.profit)}</small>
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
                        <small>ربح {formatMoney(cat.profit)}</small>
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
