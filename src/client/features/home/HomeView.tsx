"use client";

/**
 * @file HomeView.tsx
 * @description Home — the hub of Hesba (owner's design, 2026-11-23). No sidebar, no bottom bar,
 * no dashboard: a greeting with logout, two small numbers, the main actions, and a floating
 * «اعمل جرد» button.
 *
 * - «فلوس المحل»: every account's real balance together (`GET /api/money`: the drawer from its
 *   last count + every machine / wallet). Never a made-up number: while it loads it shows a
 *   skeleton, and on failure it says so with «جرّب تاني».
 * - «ربحك الشهر ده»: the month's net profit from the report's profit account
 *   (`GET /api/reports/home?period=month` → `profit`): goods profit + service commissions −
 *   operating expenses − losses. Labelled «تقريبي» when estimated; «—» with the reason when the
 *   data is not enough. Never sales − expenses.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import { apiGet } from "@/client/shared/api/read-cache";
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
  /** Kept for older callers; Hesba has one package (الكاشير الذكي). */
  operatingMode?: "simple" | "pos";
}

type Load<T> =
  { state: "loading" } | { state: "ok"; data: T } | { state: "error" };

const money = (piasters: number) =>
  `${(piasters / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج`;

export function HomeView({ onNavigate, onLogout }: HomeViewProps) {
  // ─── «فلوس المحل» ───
  const [cash, setCash] = useState<
    Load<{ totalPiasters: number; cashKnown: boolean }>
  >({ state: "loading" });
  const loadMoney = useCallback(() => {
    apiGet("/api/money")
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as {
          totalPiasters: number;
          cashKnown: boolean;
        };
        setCash({ state: "ok", data: d });
      })
      .catch(() => setCash({ state: "error" }));
  }, []);

  // ─── «ربحك الشهر ده» ───
  const [month, setMonth] = useState<Load<HomeReport>>({ state: "loading" });
  const loadMonth = useCallback((signal?: AbortSignal) => {
    fetchHomeReport("month", signal)
      .then((r) => setMonth({ state: "ok", data: r }))
      .catch(() => {
        if (!signal?.aborted) setMonth({ state: "error" });
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadMoney();
    loadMonth(controller.signal);
    const reload = () => {
      loadMoney();
      loadMonth(controller.signal);
    };
    window.addEventListener("hesba_stock_updated", reload);
    window.addEventListener("online", reload);
    return () => {
      controller.abort();
      window.removeEventListener("hesba_stock_updated", reload);
      window.removeEventListener("online", reload);
    };
  }, [loadMoney, loadMonth]);

  // First run: a shop with no products yet sees how to add them (null = not known yet).
  const [productCount, setProductCount] = useState<number | null>(null);
  const [onboardDismissed, setOnboardDismissed] = useState(false);
  useEffect(() => {
    let ignore = false;
    apiGet("/api/stock")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!ignore && Array.isArray(data?.inventory))
          setProductCount(data.inventory.length);
      })
      .catch(() => {});
    return () => {
      ignore = true;
    };
  }, []);

  const startWithBarcode = () => {
    try {
      sessionStorage.setItem(OPEN_STOCK_SCAN_KEY, "1");
    } catch {
      // Storage unavailable: the stock screen still opens.
    }
    onNavigate("stock");
  };

  const profit = month.state === "ok" ? month.data.profit : undefined;
  const net =
    profit?.netProfitPiasters ?? profit?.estimatedNetProfitPiasters ?? null;
  const commissions = profit?.serviceCommissionsPiasters ?? 0;

  const action = (
    route: NavRoute,
    icon: string,
    label: string,
    extra?: string,
  ) => (
    <button
      type="button"
      className={`${styles.act} ${extra ?? ""}`}
      onClick={() => onNavigate(route)}
      data-testid={`home-tile-${route}`}
    >
      <i aria-hidden="true">{icon}</i>
      <span>{label}</span>
    </button>
  );

  return (
    <div className={styles.homePage} data-testid="page-home" dir="rtl">
      <div className={styles.topRow}>
        <h2 className={styles.hello} data-testid="home-hello">
          أهلاً بيك 👋
        </h2>
        {onLogout && (
          <button
            type="button"
            className={styles.logoutTop}
            onClick={onLogout}
            data-testid="home-logout"
          >
            {t("home.logout")}
          </button>
        )}
      </div>

      <div className={styles.twoCards}>
        <button
          type="button"
          className={styles.numCard}
          onClick={() => {
            if (cash.state !== "error") return onNavigate("money");
            setCash({ state: "loading" });
            loadMoney();
          }}
          data-testid="home-money"
        >
          <small>💰 فلوس المحل</small>
          {cash.state === "loading" ? (
            <Skeleton width={90} height={26} />
          ) : cash.state === "error" ? (
            <em className={styles.numErr}>حصلت مشكلة · جرّب تاني</em>
          ) : (
            <>
              <b data-testid="home-money-total">
                {money(cash.data.totalPiasters)}
              </b>
              <em>
                {cash.data.cashKnown
                  ? "الدرج والماكينات"
                  : "من غير الدرج (عدّه الأول)"}
              </em>
            </>
          )}
        </button>
        <button
          type="button"
          className={`${styles.numCard} ${styles.numGood}`}
          onClick={() => {
            if (month.state !== "error") return onNavigate("reports");
            setMonth({ state: "loading" });
            loadMonth();
          }}
          data-testid="home-profit-month"
        >
          <small>📈 ربحك الشهر ده</small>
          {month.state === "loading" ? (
            <Skeleton width={90} height={26} />
          ) : month.state === "error" ? (
            <em className={styles.numErr}>حصلت مشكلة · جرّب تاني</em>
          ) : net === null ? (
            <>
              <b>—</b>
              <em>البيانات لسه مش كفاية</em>
            </>
          ) : (
            <>
              <b data-testid="home-profit-month-value">{money(net)}</b>
              <em>
                {profit?.status === "estimated" ? "تقريبي · " : ""}
                {commissions > 0
                  ? `منها عمولات خدمات ${money(commissions)}`
                  : "بعد المصاريف"}
              </em>
            </>
          )}
        </button>
      </div>

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

      <div className={styles.actions}>
        {action("stock", "📦", t("home.addStock"))}
        {action("expenses", "💸", t("home.expenses"))}
        {action("sales", "🛒", t("home.sell"), styles.actSell)}
        {action("people", "👥", t("home.people"))}
        {action("products", "🧃", t("home.myProducts"))}
        {action("services", "📲", "الخدمات والعمولات")}
        {action("ai", "💬", t("home.askHesba"), styles.actWide)}
      </div>

      {/* «اعمل جرد»: one floating button (not another card) */}
      <button
        type="button"
        className={styles.fab}
        onClick={() => onNavigate("stocktake")}
        aria-label="اعمل جرد"
        data-testid="home-stocktake-fab"
      >
        <span aria-hidden="true">🧮</span>
        <b>اعمل جرد</b>
      </button>
    </div>
  );
}

export default HomeView;
