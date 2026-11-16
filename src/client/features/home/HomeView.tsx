"use client";

/**
 * @file HomeView.tsx
 * @description Card-grid home dashboard with shortcuts to every feature, today's KPIs,
 * stock alert banner, and a prominent inventory shortcut.
 */

import React, { useState, useEffect } from "react";
import { Skeleton } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import { apiGet } from "@/client/shared/api/read-cache";
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

  // ─── Stock alert counts ───
  const [stockAlerts, setStockAlerts] = useState({ out: 0, low: 0 });

  useEffect(() => {
    let ignore = false;
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (ignore) return;
        if (data?.inventory && Array.isArray(data.inventory)) {
          const inv = data.inventory as Array<{ status?: string }>;
          setStockAlerts({
            out: inv.filter((i) => i.status === "out").length,
            low: inv.filter((i) => i.status === "low").length,
          });
        }
      })
      .catch(() => {});
    const onStockUpdate = () => {
      apiGet("/api/stock")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (ignore) return;
          if (data?.inventory && Array.isArray(data.inventory)) {
            const inv = data.inventory as Array<{ status?: string }>;
            setStockAlerts({
              out: inv.filter((i) => i.status === "out").length,
              low: inv.filter((i) => i.status === "low").length,
            });
          }
        })
        .catch(() => {});
    };
    window.addEventListener("hesba_stock_updated", onStockUpdate);
    return () => {
      ignore = true;
      window.removeEventListener("hesba_stock_updated", onStockUpdate);
    };
  }, []);

  const todayRevenue = report?.sales.revenuePiasters ?? null;
  const todayProfit = report?.sales.grossProfitPiasters ?? null;

  // ─── Alert banner text ───
  const alertParts: string[] = [];
  if (stockAlerts.out > 0) alertParts.push(`${stockAlerts.out} خلص`);
  if (stockAlerts.low > 0) alertParts.push(`${stockAlerts.low} قرب يخلص`);
  const stockTotal = stockAlerts.out + stockAlerts.low;
  if (alertCount > stockTotal) {
    alertParts.push(`${alertCount - stockTotal} قرب تنتهي صلاحيته`);
  }
  if (alertParts.length === 0 && alertCount > 0) {
    alertParts.push(`${alertCount} تنبيه`);
  }
  const alertText = alertParts.join(" · ");
  const hasAlerts = alertText.length > 0;

  // ─── Dashboard ───
  return (
    <div className={styles.page} data-testid="page-home" dir="rtl">
      {/* Greeting */}
      <div className={styles.welcome}>
        <span className={styles.welcomeText}>{t("home.welcome")}</span>
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

      {/* Alert banner */}
      {hasAlerts && onOpenAlerts && (
        <button
          type="button"
          className={styles.alertBanner}
          onClick={onOpenAlerts}
        >
          <span className={styles.alertIcon}>⚠</span>
          <span>{alertText}</span>
        </button>
      )}

      {/* Action cards grid — matches reference screenshots */}
      <div className={styles.grid}>
        {/* Row 1: stock + sales */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("stock")}
        >
          <span className={styles.cardBadge}>١</span>
          <span className={styles.cardIcon}>📦</span>
          <span className={styles.cardLabel}>{t("home.addStock")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("sales")}
        >
          <span className={styles.cardBadge}>٢</span>
          <span className={styles.cardIcon}>🛒</span>
          <span className={styles.cardLabel}>{t("home.sell")}</span>
        </button>

        {/* Row 2: expenses + people */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("expenses")}
        >
          <span className={styles.cardBadge}>٣</span>
          <span className={styles.cardIcon}>💰</span>
          <span className={styles.cardLabel}>{t("home.expenses")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("people")}
        >
          <span className={styles.cardIcon}>👥</span>
          <span className={styles.cardLabel}>{t("home.people")}</span>
        </button>

        {/* Row 3: products + wallets */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("products")}
        >
          <span className={styles.cardIcon}>🧃</span>
          <span className={styles.cardLabel}>{t("home.myProducts")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("alerts")}
        >
          <span className={styles.cardIcon}>💳</span>
          <span className={styles.cardLabel}>{t("home.walletsMachines")}</span>
        </button>

        {/* Row 4: ai (single) */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("ai")}
        >
          <span className={styles.cardIcon}>💬</span>
          <span className={styles.cardLabel}>{t("home.askHesba")}</span>
        </button>
      </div>

      {/* Inventory — prominent full-width card */}
      <button
        type="button"
        className={`${styles.card} ${styles.cardGold} ${styles.cardWide} ${styles.cardInventory}`}
        onClick={() => onNavigate("inventory")}
      >
        <span className={styles.cardIcon}>📋</span>
        <span className={styles.cardLabel}>{t("home.inventory")}</span>
      </button>

      {/* Logout */}
      {onLogout && (
        <button type="button" className={styles.logoutBtn} onClick={onLogout}>
          {t("home.logout")}
        </button>
      )}
    </div>
  );
}

export default HomeView;
