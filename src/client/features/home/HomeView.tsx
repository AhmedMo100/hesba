"use client";

/**
 * @file HomeView.tsx
 * @description Home dashboard (V19 reference): today's KPIs, the drawer, the stock alerts
 * strip and the shortcut tiles to every screen.
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

  // ─── Stock alert counts (out / low / near expiry), from the stock levels ───
  const [stockAlerts, setStockAlerts] = useState({ out: 0, low: 0, exp: 0 });

  useEffect(() => {
    let ignore = false;
    const load = () => {
      apiGet("/api/stock")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (ignore) return;
          if (data?.inventory && Array.isArray(data.inventory)) {
            const inv = data.inventory as Array<{
              status?: string;
              hasNearExpiry?: boolean;
            }>;
            setStockAlerts({
              out: inv.filter((i) => i.status === "out").length,
              low: inv.filter((i) => i.status === "low").length,
              exp: inv.filter((i) => i.hasNearExpiry).length,
            });
          }
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("hesba_stock_updated", load);
    return () => {
      ignore = true;
      window.removeEventListener("hesba_stock_updated", load);
    };
  }, []);

  const todayRevenue = report?.sales.revenuePiasters ?? null;
  const todayProfit = report?.sales.grossProfitPiasters ?? null;
  const todayCount = report?.sales.count ?? null;

  const money = (piasters: number) =>
    `${(piasters / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج`;

  const { out, low, exp } = stockAlerts;
  const hasStockAlerts = out + low + exp > 0;
  const alertText = hasStockAlerts
    ? [
        t("home.alertOut", { count: out }),
        t("home.alertLow", { count: low }),
        t("home.alertExpiry", { count: exp }),
      ].join(" · ")
    : alertCount > 0
      ? t("home.alertGeneric", { count: alertCount })
      : "";

  const tile = (
    route: NavRoute,
    icon: string,
    label: string,
    tone: string | undefined,
    testId?: string,
  ) => (
    <button
      type="button"
      className={`${styles.t} ${tone ?? ""}`}
      onClick={() => onNavigate(route)}
      data-testid={testId}
    >
      <i aria-hidden="true">{icon}</i>
      {label}
    </button>
  );

  // ─── Dashboard (docs/ui-reference/v19-demo) ───
  return (
    <div className={styles.page} data-testid="page-home" dir="rtl">
      <div className={styles.sumrow}>
        <button
          type="button"
          className={styles.stat}
          onClick={() => onNavigate("inventory")}
        >
          <small>{t("home.soldToday")}</small>
          <b>
            {reportLoading ? (
              <Skeleton width={70} height={24} />
            ) : todayRevenue === null ? (
              "—"
            ) : (
              money(todayRevenue)
            )}
          </b>
        </button>
        <button
          type="button"
          className={`${styles.stat} ${styles.good}`}
          onClick={() => onNavigate("inventory")}
        >
          <small>{t("home.profitToday")}</small>
          <b>
            {reportLoading ? (
              <Skeleton width={70} height={24} />
            ) : todayProfit === null ? (
              "—"
            ) : (
              money(todayProfit)
            )}
          </b>
        </button>
      </div>

      {/* The drawer: today's sales in the sales screen */}
      <button
        type="button"
        className={styles.drw}
        onClick={() => onNavigate("sales")}
        aria-label={t("home.cashDrawer")}
        data-testid="home-drawer"
      >
        <div>
          <small>{t("home.drawerLabel")}</small>
          <b>
            {reportLoading ? (
              <Skeleton width={60} height={24} />
            ) : todayCount === null ? (
              "—"
            ) : (
              t("home.drawerCount", { count: todayCount })
            )}
          </b>
        </div>
        <span>{t("home.drawerOpen")}</span>
      </button>

      {alertText && (
        <button
          type="button"
          className={styles.warn}
          onClick={() => onNavigate("inventory")}
          data-testid="home-alerts"
        >
          ⚠️ {alertText}
        </button>
      )}

      <div className={styles.tiles}>
        {tile("stock", "📦", t("home.addStock"), styles.cIn)}
        {tile("expenses", "💰", t("home.expenses"), styles.cOut)}
        {tile("sales", "🛒", t("home.sell"), `${styles.cSell} ${styles.wide}`)}
        {tile("people", "👥", t("home.people"), styles.cPpl)}
        {tile("ai", "💬", t("home.askHesba"), "")}
        {tile("alerts", "💳", t("home.walletsMachines"), styles.cMach)}
        {tile("products", "🧃", t("home.myProducts"), "")}
        {tile(
          "inventory",
          "📋",
          t("home.inventory"),
          `${styles.cInv} ${styles.wide}`,
        )}
      </div>

      {onLogout && (
        <button type="button" className={styles.link} onClick={onLogout}>
          {t("home.logout")}
        </button>
      )}
    </div>
  );
}

export default HomeView;
