"use client";

/**
 * @file HomeView.tsx
 * @description Card-grid home dashboard with shortcuts to every feature, today's KPIs,
 * and an inventory sub-view (الجرد) reachable from its card.
 */

import React, { useState, useEffect } from "react";
import { Icon, Skeleton } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
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

  const todayRevenue = report?.sales.revenuePiasters ?? null;
  const todayProfit = report?.sales.grossProfitPiasters ?? null;

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
        {/* Row 1: stock + expenses — dark green */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("stock")}
        >
          <span className={styles.cardIcon}>📦</span>
          <span className={styles.cardLabel}>{t("home.addStock")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("expenses")}
        >
          <span className={styles.cardIcon}>💰</span>
          <span className={styles.cardLabel}>{t("home.expenses")}</span>
        </button>

        {/* Row 2: sell — full width, gold (distinctive) */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardGold} ${styles.cardWide}`}
          onClick={() => onNavigate("sales")}
        >
          <span className={styles.cardIcon}>🛒</span>
          <span className={styles.cardLabel}>{t("home.sell")}</span>
        </button>

        {/* Row 3: ask hesba + people — dark green */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("ai")}
        >
          <span className={styles.cardIcon}>💬</span>
          <span className={styles.cardLabel}>{t("home.askHesba")}</span>
        </button>
        <button
          type="button"
          className={`${styles.card} ${styles.cardDark}`}
          onClick={() => onNavigate("people")}
        >
          <span className={styles.cardIcon}>👥</span>
          <span className={styles.cardLabel}>{t("home.people")}</span>
        </button>

        {/* Row 4: products + wallets — dark green */}
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

        {/* Row 5: inventory — full width, gold (distinctive) */}
        <button
          type="button"
          className={`${styles.card} ${styles.cardGold} ${styles.cardWide}`}
          onClick={() => onNavigate("inventory")}
        >
          <span className={styles.cardIcon}>📋</span>
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
