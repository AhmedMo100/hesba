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
import { fetchDrawer, type DrawerView } from "@/client/shared/api/drawer";
import { packWord, unitWord } from "@/client/shared/unit-labels";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import styles from "./HomeView.module.css";

/** Home → stock: open the barcode scanner straight away (first-run «ابدأ بالباركود»). */
export const OPEN_STOCK_SCAN_KEY = "hesba_open_stock_scan";

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
  /** إدارة المحل: «مبيعات اليوم» instead of «بيع حاجة» (ADR-0033). */
  operatingMode?: "simple" | "pos";
}

export function HomeView({
  onNavigate,
  alertCount = 0,
  onLogout,
  operatingMode = "pos",
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
  // First run: a shop with no products yet sees how to add them (null = not known yet).
  const [productCount, setProductCount] = useState<number | null>(null);
  const [onboardDismissed, setOnboardDismissed] = useState(false);

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
            setProductCount(inv.length);
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

  // ─── The drawer's real balance (ADR-0031); never today's sales ───
  const [drawer, setDrawer] = useState<DrawerView | null>(null);
  const [drawerFailed, setDrawerFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchDrawer()
        .then((d) => {
          if (!alive) return;
          setDrawer(d);
          setDrawerFailed(false);
        })
        .catch(() => alive && setDrawerFailed(true));
    void load();
    window.addEventListener("online", load);
    return () => {
      alive = false;
      window.removeEventListener("online", load);
    };
  }, []);

  const todayRevenue = report?.sales.revenuePiasters ?? null;
  const todayProfit = report?.sales.grossProfitPiasters ?? null;

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
    num?: string,
  ) => (
    <button
      type="button"
      className={`${styles.tile} ${tone ?? ""}`}
      onClick={() => onNavigate(route)}
      data-testid={`home-tile-${route}`}
    >
      {num && <span className={styles.tn}>{num}</span>}
      <i aria-hidden="true">{icon}</i>
      {label}
    </button>
  );

  const startWithBarcode = () => {
    try {
      sessionStorage.setItem(OPEN_STOCK_SCAN_KEY, "1");
    } catch {
      // Storage unavailable: the stock screen still opens.
    }
    onNavigate("stock");
  };

  // ─── Dashboard: V19 summary and drawer, V17 tiles and logout ───
  return (
    <div className={styles.page} data-testid="page-home" dir="rtl">
      {productCount === 0 && !onboardDismissed && (
        <div className={styles.banner} data-testid="home-onboarding">
          <b>⚠️ لسه ماضفتش منتجات محلك</b>
          <span>امسح الباركود وضيف كل منتجات المحل مرة واحدة.</span>
          <div className={styles.brow}>
            <button
              type="button"
              className={`${styles.mini} ${styles.miniDark}`}
              onClick={startWithBarcode}
              data-testid="home-onboarding-scan"
            >
              ابدأ بالباركود ←
            </button>
            <button
              type="button"
              className={styles.mini}
              onClick={() => setOnboardDismissed(true)}
            >
              بعدين
            </button>
          </div>
        </div>
      )}

      {/* V17: the greeting above the day's numbers */}
      <h2 className={styles.hello} data-testid="home-hello">
        أهلاً بيك 👋
      </h2>

      <div className={styles.sumrow}>
        <button
          type="button"
          className={styles.stat}
          onClick={() => onNavigate("reports")}
          data-testid="home-sold-today"
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
          onClick={() => onNavigate("reports")}
          data-testid="home-profit-today"
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

      {/* The drawer (V19): what should be in it now, from the last count */}
      <button
        type="button"
        className={styles.drw}
        onClick={() => onNavigate("drawer")}
        aria-label={t("home.cashDrawer")}
        data-testid="home-drawer"
      >
        <div>
          <small>
            {drawer && !drawer.lastCount
              ? "🧮 الدرج"
              : "🧮 المفروض في الدرج دلوقتي"}
          </small>
          <b>
            {!drawer && !drawerFailed ? (
              <Skeleton width={80} height={24} />
            ) : drawer?.expectedPiasters != null ? (
              money(drawer.expectedPiasters)
            ) : drawer && !drawer.lastCount ? (
              "عدّه أول مرة"
            ) : (
              "—"
            )}
          </b>
        </div>
        <span>عدّ ←</span>
      </button>

      {alertText && (
        <button
          type="button"
          className={styles.warn}
          onClick={() => onNavigate("notifications")}
          data-testid="home-alerts"
        >
          ⚠️ {alertText}
        </button>
      )}

      {/* V17 tiles: the three steps of the day numbered, «بيع حاجة» stands out */}
      <div className={styles.tiles17}>
        {tile("stock", "📦", t("home.addStock"), styles.tileNum, "١")}
        {tile("expenses", "💰", t("home.expenses"), styles.tileNum, "٢")}
        {operatingMode === "simple"
          ? tile("daily-sales", "💵", "مبيعات اليوم", styles.tileSell, "٣")
          : tile("sales", "🛒", t("home.sell"), styles.tileSell, "٣")}
        {tile("people", "👥", t("home.people"), undefined)}
        {tile("alerts", "💳", t("home.walletsMachines"), undefined)}
        {tile("products", "🧃", t("home.myProducts"), undefined)}
        {tile("inventory", "📋", t("home.inventory"), styles.tileAlt)}
        {tile("ai", "💬", t("home.askHesba"), styles.tileAlt)}
      </div>

      {onLogout && (
        <button
          type="button"
          className={styles.logout17}
          onClick={onLogout}
          data-testid="home-logout"
        >
          {t("home.logout")}
        </button>
      )}
    </div>
  );
}

export default HomeView;
