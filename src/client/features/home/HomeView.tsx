"use client";

/**
 * @file HomeView.tsx
 * @description Home — the hub of Hesba (owner's design, ADR-0036). No sidebar, no bottom bar:
 * a greeting with the logout button, two numbers, one line of alerts, and the eight actions.
 *
 * - «فلوس المحل»: every account's real balance together (`GET /api/money`: the drawer from its
 *   last count + every machine / wallet). A tap opens «فلوس حِسبة». Never a made-up number:
 *   while it loads it shows a skeleton, and on failure it says so with «جرّب تاني».
 * - The profit card follows the package: «ربحك الشهر ده» (إدارة المحل: this month from the 1st)
 *   or «ربحك النهارده» (الكاشير الذكي: today) — the net profit of the report's profit account
 *   (goods profit + service commissions − operating expenses − losses), labelled «تقريبي» when
 *   estimated; «—» when the data is not enough. Never sales − expenses.
 * - Alerts: one short line (out of stock / running low / near expiry, or the alert count) that
 *   opens the existing alerts screen.
 * - Actions: ١ دخلت بضاعة · ٢ صرفت فلوس · ٣ بيع حاجة (gold) · حسابات الناس · بضاعتي ·
 *   الخدمات والعمولات · اسأل حسبة · الجرد (gold, like «بيع حاجة»).
 */

import React, { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/client/shared/ui";
import { t } from "@/client/shared/i18n";
import { fetchHomeReport, type HomeReport } from "@/client/shared/api/reports";
import { apiGet } from "@/client/shared/api/read-cache";
import { packWord, unitWord } from "@/client/shared/unit-labels";
import { toCairoDateString } from "@/domain/time";
import { monthQuery } from "@/domain/report-periods";
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

  // ─── «ربحك الشهر ده» (إدارة المحل) / «ربحك النهارده» (الكاشير الذكي) ───
  const [month, setMonth] = useState<Load<HomeReport>>({ state: "loading" });
  const loadMonth = useCallback(
    (signal?: AbortSignal) => {
      const today = toCairoDateString(new Date());
      const req = pos
        ? fetchHomeReport("today", signal)
        : fetchHomeReport(
            "custom",
            signal,
            monthQuery(today.slice(0, 7), today),
          );
      req
        .then((r) => setMonth({ state: "ok", data: r }))
        .catch(() => {
          if (!signal?.aborted) setMonth({ state: "error" });
        });
    },
    [pos],
  );

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
        : "";

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

  const tile = (
    route: NavRoute,
    icon: string,
    label: string,
    tone?: string,
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
          data-testid="home-profit"
        >
          <small>{pos ? "📈 ربحك النهارده" : "📈 ربحك الشهر ده"}</small>
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
              <b data-testid="home-profit-value">{money(net)}</b>
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

      {/* One line of alerts: opens the alerts screen as it is. */}
      <button
        type="button"
        className={`${styles.alertLine} ${alertText ? "" : styles.alertLineCalm}`}
        onClick={() => onNavigate("notifications")}
        data-testid="home-alerts"
      >
        <span aria-hidden="true">{alertText ? "⚠️" : "🔔"}</span>
        <span>{alertText || "مفيش تنبيهات دلوقتي"}</span>
        <span className={styles.alertGo} aria-hidden="true">
          ←
        </span>
      </button>

      {/* The eight actions, two per row: the day's three steps numbered, «بيع حاجة» and
          «الجرد» in gold. */}
      <div className={styles.tiles17}>
        {tile("stock", "📦", t("home.addStock"), styles.tileNum, "١")}
        {tile("expenses", "💰", t("home.expenses"), styles.tileNum, "٢")}
        {pos
          ? tile("sales", "🛒", t("home.sell"), styles.tileSell, "٣")
          : tile("daily-sales", "🛒", t("home.sell"), styles.tileSell, "٣")}
        {tile("people", "👥", t("home.people"))}
        {tile("products", "🧃", t("home.myProducts"))}
        {tile("services", "📲", "الخدمات والعمولات")}
        {tile("ai", "💬", t("home.askHesba"))}
        {tile("stocktake", "📋", "الجرد", styles.tileSell)}
      </div>
    </div>
  );
}

export default HomeView;
