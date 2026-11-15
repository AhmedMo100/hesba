"use client";

/**
 * @file HomeView.tsx
 * @description Card-grid home dashboard with shortcuts to every feature, today's KPIs,
 * and an inventory sub-view (الجرد) reachable from its card.
 */

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useMemo } from "react";
import { SearchBox, Icon, Empty, Skeleton } from "@/client/shared/ui";
import { formatMoney, t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import { normalizeArabic } from "@/domain/normalize";
import type { StockInventoryItem } from "@/client/shared/store-items";
import { packWord, unitWord } from "@/client/shared/unit-labels";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import styles from "./HomeView.module.css";

export function formatQtyText(
  unitMode: "piece" | "weight",
  qtyBase: number,
  packQty = 1,
  unit = "piece",
  packName?: string,
): string {
  if (unitMode === "weight") {
    const kg = qtyBase / 1000;
    return `${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
  }
  const word = unitWord(unit);
  if (packQty > 1 && qtyBase >= packQty) {
    const packs = Math.floor(qtyBase / packQty);
    const rem = qtyBase % packQty;
    const pName = packWord(packName, packQty);
    if (rem === 0) {
      return `${packs} ${pName}`;
    }
    return `${packs} ${pName} و ${rem} ${word}`;
  }
  return `${qtyBase} ${word}`;
}

export interface HomeViewProps {
  onNavigate: (route: NavRoute) => void;
  alertCount?: number;
  onOpenAlerts?: () => void;
  onLogout?: () => void;
}

export function HomeView({
  onNavigate,
  alertCount = 0,
  onOpenAlerts,
  onLogout,
}: HomeViewProps) {
  const [view, setView] = useState<"dashboard" | "inventory">("dashboard");

  // ─── Today's KPIs (from report) ───
  const [report, setReport] = useState<HomeReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = (retriesLeft: number) => {
      fetchHomeReport("today", controller.signal)
        .then((r) => {
          setReport(r);
          setReportLoading(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          if (retriesLeft > 0) {
            retry = setTimeout(() => load(retriesLeft - 1), 1500);
          } else {
            setReportLoading(false);
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
  }, []);

  const todayRevenue = report?.sales.revenuePiasters ?? null;
  const todayProfit = report?.sales.grossProfitPiasters ?? null;

  // ─── Inventory data ───
  const [inventory, setInventory] = useState<StockInventoryItem[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      try {
        const stockRes = await apiGet("/api/stock").catch(() => null);
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

  const inventoryRows = useMemo(() => {
    return inventory.map((item) => {
      const factor = item.unitMode === "weight" ? 1000 : 1;
      const q = item.currentStockBase / factor;
      const buyPrice = item.buyPricePiasters || 0;
      const sellPrice = item.sellPricePiasters || 0;
      return {
        ...item,
        costPiasters: Math.round(q * buyPrice),
        valPiasters: Math.round(q * sellPrice),
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

  const totalCostPiasters = useMemo(
    () => inventoryRows.reduce((sum, item) => sum + item.costPiasters, 0),
    [inventoryRows],
  );
  const totalSellPiasters = useMemo(
    () => inventoryRows.reduce((sum, item) => sum + item.valPiasters, 0),
    [inventoryRows],
  );
  const expectedProfitPiasters = totalSellPiasters - totalCostPiasters;

  const todayDateLabel = useMemo(() => {
    return new Intl.DateTimeFormat("ar-EG", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
  }, []);

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
      return [
        `"${item.productName.replace(/"/g, '""')}"`,
        `"${(item.category || "متفرقات").replace(/"/g, '""')}"`,
        `"${qText.replace(/"/g, '""')}"`,
        (item.costPiasters / 100).toFixed(2),
        (item.valPiasters / 100).toFixed(2),
      ].join(",");
    });
    const csvContent = "﻿" + [headers.join(","), ...rowsCsv].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `jard-${new Date().toISOString().split("T")[0]}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ─── Inventory sub-view ───
  if (view === "inventory") {
    return (
      <div className={styles.page} data-testid="page-home" dir="rtl">
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => setView("dashboard")}
        >
          <Icon n="left" s={18} />
          <span>{t("common.back")}</span>
        </button>

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
            <b>{inventory.filter((i) => i.status === "out").length}</b>
          </div>
          <div className={styles.kpi}>
            <small>قرب يخلص</small>
            <b>{inventory.filter((i) => i.status === "low").length}</b>
          </div>
        </div>

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
      </div>
    );
  }

  // ─── Dashboard card-grid view ───
  return (
    <div className={styles.page} data-testid="page-home" dir="rtl">
      {/* Welcome row with action buttons */}
      <div className={styles.welcome}>
        <span className={styles.welcomeText}>{t("home.welcome")}</span>
        <div className={styles.welcomeActions}>
          {onOpenAlerts && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onOpenAlerts}
              aria-label={t("home.notifications")}
              title={t("home.notifications")}
            >
              <Icon n="bell" s={16} />
              <span>{t("home.notifications")}</span>
              {alertCount > 0 && (
                <span className={styles.actionBadge}>
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </button>
          )}
          <button
            type="button"
            className={styles.actionBtn}
            onClick={() => onNavigate("sales")}
            aria-label={t("home.cashDrawer")}
            title={t("home.cashDrawer")}
          >
            <Icon n="wallet" s={16} />
            <span>{t("home.cashDrawer")}</span>
          </button>
        </div>
      </div>

      {/* Today's KPI cards */}
      <div className={styles.kpiRow}>
        <div className={styles.kpiCard}>
          <small>{t("home.soldToday")}</small>
          <b>
            {reportLoading ? (
              <Skeleton width={60} height={20} />
            ) : todayRevenue === null ? (
              "—"
            ) : (
              `${(todayRevenue / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${t("home.pound")}`
            )}
          </b>
        </div>
        <div className={styles.kpiCard}>
          <small>{t("home.profitToday")}</small>
          <b>
            {reportLoading ? (
              <Skeleton width={60} height={20} />
            ) : todayProfit === null ? (
              "—"
            ) : (
              `${(todayProfit / 100).toLocaleString("en-US", { maximumFractionDigits: 1 })} ${t("home.pound")}`
            )}
          </b>
        </div>
      </div>

      {/* Action cards grid */}
      <div className={styles.grid}>
        {/* Row 1: dark green */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("sales")}
        >
          <span className={styles.cardBadge}>٢</span>
          <span className={styles.cardIcon}>🛒</span>
          <span className={styles.cardLabel}>{t("home.sell")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("stock")}
        >
          <span className={styles.cardBadge}>١</span>
          <span className={styles.cardIcon}>📦</span>
          <span className={styles.cardLabel}>{t("home.addStock")}</span>
        </button>

        {/* Row 2: dark green */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("people")}
        >
          <span className={styles.cardIcon}>👥</span>
          <span className={styles.cardLabel}>{t("home.people")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("expenses")}
        >
          <span className={styles.cardBadge}>٣</span>
          <span className={styles.cardIcon}>💰</span>
          <span className={styles.cardLabel}>{t("home.expenses")}</span>
        </button>

        {/* Row 3: light */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardLight}`}
          onClick={() => onNavigate("products")}
        >
          <span className={styles.cardIcon}>🧃</span>
          <span className={styles.cardLabel}>{t("home.myProducts")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardLight}`}
          onClick={() => onNavigate("alerts")}
        >
          <span className={styles.cardIcon}>💳</span>
          <span className={styles.cardLabel}>{t("home.walletsMachines")}</span>
        </button>

        {/* Row 4: gold/beige */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardGold}`}
          onClick={() => onNavigate("ai")}
        >
          <span className={styles.cardIcon}>💬</span>
          <span className={styles.cardLabel}>{t("home.askHesba")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardGold}`}
          onClick={() => setView("inventory")}
        >
          <span className={styles.cardIcon}>📊</span>
          <span className={styles.cardLabel}>{t("home.inventory")}</span>
        </button>
      </div>

      {/* Logout button */}
      {onLogout && (
        <button type="button" className={styles.logoutBtn} onClick={onLogout}>
          {t("home.logout")}
        </button>
      )}
    </div>
  );
}

export default HomeView;
