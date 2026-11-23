"use client";

import React from "react";
import styles from "./SideNav.module.css";
import { Icon, type IconName } from "../shared/ui";
import { t } from "../shared/i18n";
import type { NavRoute } from "./BottomNav";

interface SideNavProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  /** إدارة المحل shows «مبيعات اليوم» where الكاشير الذكي shows «البيع» (ADR-0033). */
  operatingMode?: "simple" | "pos";
}

interface NavItem {
  route: NavRoute;
  labelKey: string;
  icon: IconName;
  isKey?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { route: "home", labelKey: "nav.home", icon: "home" },
  { route: "sales", labelKey: "nav.sales", icon: "cart", isKey: true },
  { route: "products", labelKey: "nav.products", icon: "tag" },
  { route: "stock", labelKey: "nav.stock", icon: "boxes" },
  { route: "expenses", labelKey: "nav.expenses", icon: "wallet" },
  { route: "people", labelKey: "nav.people", icon: "users" },
  { route: "money", labelKey: "nav.money", icon: "wallet" },
  { route: "services", labelKey: "nav.services", icon: "phone" },
  { route: "stocktake", labelKey: "nav.stocktake", icon: "layers" },
  { route: "ai", labelKey: "nav.ai", icon: "sparkle" },
];

export function SideNav({
  activeRoute,
  onNavigate,
  operatingMode = "pos",
}: SideNavProps) {
  const items = NAV_ITEMS.map((item) =>
    item.route === "sales" && operatingMode === "simple"
      ? {
          ...item,
          route: "daily-sales" as const,
          labelKey: "nav.dailySales",
          icon: "wallet" as const,
        }
      : item,
  );
  return (
    <aside className={styles.side} aria-label={t("common.menu")}>
      <div className={styles.logoSection}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset, precached for offline */}
        <img src="/logo.png" alt="" width={28} height={40} />
        <span>{t("common.appName")}</span>
      </div>

      <nav className={styles.nav}>
        {items.map((item) => {
          const isSelected = activeRoute === item.route;
          const classes = [
            styles.nv,
            isSelected ? styles.on : "",
            item.isKey ? styles.key : "",
          ]
            .filter(Boolean)
            .join(" ");

          const label = t(item.labelKey);

          return (
            <button
              type="button"
              key={item.route}
              className={classes}
              onClick={() => onNavigate(item.route)}
              aria-label={label}
              aria-current={isSelected ? "page" : undefined}
            >
              <Icon n={item.icon} s={20} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
