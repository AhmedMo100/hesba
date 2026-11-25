"use client";

/**
 * @file HomeView.tsx
 * @description Home — the hub of Hesba (owner's layout, ADR-0037). No sidebar, no bottom bar,
 * in this order:
 *
 * 1. «أهلاً بيك» (with a small bell that opens «التنبيهات», its count on it).
 * 2. «فلوس المحل», the row's full width: every account's real balance together
 *    (`GET /api/money`). A tap opens «فلوس حِسبة». Never a made-up number: a skeleton while it
 *    loads, «جرّب تاني» on failure. (No profit card on Home: profit lives in the reports.)
 * 3. The day's four steps, numbered ١–٤ with arrows between them (RTL): دخلت بضاعة → صرفت فلوس
 *    → بيعت حاجة → شوف تقاريرك.
 * 4. «الجرد», the row's full width.
 * 5. البضاعة · الخدمات · اسأل حسبة (a slightly different colour) · حسابات الناس — not numbered.
 * 6. The only logout, at the very end, the row's full width.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Icon, Skeleton } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
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
  /** إدارة المحل (simple) or الكاشير الذكي (pos): the profit card's period and «بيع حاجة». */
  operatingMode?: "simple" | "pos";
}

type Load<T> =
  { state: "loading" } | { state: "ok"; data: T } | { state: "error" };

const money = (piasters: number) =>
  `${(piasters / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج`;

export function HomeView({
  onNavigate,
  onLogout,
  alertCount = 0,
  operatingMode = "pos",
}: HomeViewProps) {
  const pos = operatingMode === "pos";
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

  useEffect(() => {
    loadMoney();
    window.addEventListener("hesba_stock_updated", loadMoney);
    window.addEventListener("online", loadMoney);
    return () => {
      window.removeEventListener("hesba_stock_updated", loadMoney);
      window.removeEventListener("online", loadMoney);
    };
  }, [loadMoney]);

  // Stock alerts (out / low / near expiry) and the first-run hint, from the stock levels.
  const [stockAlerts, setStockAlerts] = useState({ out: 0, low: 0, exp: 0 });
  const [productCount, setProductCount] = useState<number | null>(null);
  const [onboardDismissed, setOnboardDismissed] = useState(false);
  useEffect(() => {
    let ignore = false;
    const load = () => {
      apiGet("/api/stock")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (ignore || !Array.isArray(data?.inventory)) return;
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
  const { out, low, exp } = stockAlerts;
  const alertsTotal = out + low + exp > 0 ? out + low + exp : alertCount;
  const alertText =
    out + low + exp > 0
      ? [
          out > 0 && t("home.alertOut", { count: out }),
          low > 0 && t("home.alertLow", { count: low }),
          exp > 0 && t("home.alertExpiry", { count: exp }),
        ]
          .filter(Boolean)
          .join(" · ")
      : alertCount > 0
        ? t("home.alertGeneric", { count: alertCount })
        : "مفيش تنبيهات دلوقتي";

  const startWithBarcode = () => {
    try {
      sessionStorage.setItem(OPEN_STOCK_SCAN_KEY, "1");
    } catch {
      // Storage unavailable: the stock screen still opens.
    }
    onNavigate("stock");
  };

  const sellRoute: NavRoute = pos ? "sales" : "daily-sales";
  const step = (
    route: NavRoute,
    num: string,
    icon: string,
    label: string,
    tone?: string,
  ) => (
    <button
      type="button"
      className={`${styles.step} ${tone ?? ""}`}
      onClick={() => onNavigate(route)}
      data-testid={`home-tile-${route}`}
    >
      <span className={styles.stepNum} aria-hidden="true">
        {num}
      </span>
      <i aria-hidden="true">{icon}</i>
      <span className={styles.stepLabel}>{label}</span>
    </button>
  );
  const arrow = (
    <span className={styles.stepArrow} aria-hidden="true">
      <Icon n="left" s={18} sw={2.8} />
    </span>
  );
  const tile = (
    route: NavRoute,
    icon: string,
    label: string,
    tone?: string,
  ) => (
    <button
      type="button"
      className={`${styles.tile} ${tone ?? ""}`}
      onClick={() => onNavigate(route)}
      data-testid={`home-tile-${route}`}
    >
      <i aria-hidden="true">{icon}</i>
      {label}
    </button>
  );

  return (
    <div className={styles.homePage} data-testid="page-home" dir="rtl">
      {/* 1. The greeting, and a small bell for «التنبيهات». */}
      <div className={styles.topRow}>
        <h2 className={styles.hello} data-testid="home-hello">
          أهلاً بيك 👋
        </h2>
        <button
          type="button"
          className={styles.bell}
          onClick={() => onNavigate("notifications")}
          aria-label={`التنبيهات: ${alertText}`}
          title={alertText}
          data-testid="home-alerts"
        >
          <Icon n="bell" s={22} sw={2.2} />
          {alertsTotal > 0 && (
            <span className={styles.bellCount} data-testid="home-alerts-count">
              {alertsTotal > 99 ? "99+" : alertsTotal}
            </span>
          )}
        </button>
      </div>

      {/* 2. «فلوس المحل», the row's full width. */}
      <button
        type="button"
        className={`${styles.numCard} ${styles.moneyWide}`}
        onClick={() => {
          if (cash.state !== "error") return onNavigate("money");
          setCash({ state: "loading" });
          loadMoney();
        }}
        data-testid="home-money"
      >
        <small>💰 فلوس المحل</small>
        {cash.state === "loading" ? (
          <Skeleton width={120} height={30} />
        ) : cash.state === "error" ? (
          <em className={styles.numErr}>حصلت مشكلة · جرّب تاني</em>
        ) : (
          <>
            <b data-testid="home-money-total">
              {money(cash.data.totalPiasters)}
            </b>
            <em>
              {cash.data.cashKnown
                ? "الدرج والماكينات والمحافظ"
                : "من غير الدرج (عدّه الأول)"}
            </em>
          </>
        )}
      </button>

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

      {/* 3. The day's four steps: ١ ← ٢, then down to ٣ ← ٤ (RTL). */}
      <div className={styles.steps} data-testid="home-steps">
        {step("stock", "١", "📦", "دخلت بضاعة", styles.stepGreen)}
        {arrow}
        {step("expenses", "٢", "💰", "صرفت فلوس", styles.stepGreen)}
        <span className={styles.stepTurn} aria-hidden="true">
          <span className={styles.stepTurnHead} />
        </span>
        {step(sellRoute, "٣", "🛒", "بيعت حاجة", styles.stepGold)}
        {arrow}
        {step("reports", "٤", "📊", "شوف تقاريرك", styles.stepGreen)}
      </div>

      {/* 4. «الجرد», the row's full width. */}
      <button
        type="button"
        className={styles.stocktakeWide}
        onClick={() => onNavigate("stocktake")}
        data-testid="home-tile-stocktake"
      >
        <i aria-hidden="true">📋</i>
        الجرد
      </button>

      {/* 5. Four more, not numbered; «اسأل حسبة» stands out a little. */}
      <div className={styles.tiles17}>
        {tile("products", "🧃", "البضاعة")}
        {tile("services", "📲", "الخدمات")}
        {tile("ai", "💬", t("home.askHesba"), styles.tileAsk)}
        {tile("people", "👥", t("home.people"))}
      </div>

      {/* 6. The only logout: at the very end of the page, the row's full width. */}
      {onLogout && (
        <button
          type="button"
          className={styles.logoutBottom}
          onClick={onLogout}
          data-testid="home-logout"
        >
          <Icon n="logout" s={22} sw={2.4} />
          {t("profile.logout")}
        </button>
      )}
    </div>
  );
}

export default HomeView;
