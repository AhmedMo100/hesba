"use client";

import React from "react";
import styles from "./SideNav.module.css";
import { Icon, type IconName } from "../shared/ui";
import { t } from "../shared/i18n";
import type { NavRoute } from "./BottomNav";

interface SideNavProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
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
  { route: "products", labelKey: "nav.products", icon: "box" },
  { route: "stock", labelKey: "nav.stock", icon: "layers" },
  { route: "expenses", labelKey: "nav.expenses", icon: "wallet" },
  { route: "people", labelKey: "nav.people", icon: "users" },
  { route: "alerts", labelKey: "nav.alerts", icon: "bell" },
  { route: "ai", labelKey: "nav.ai", icon: "sparkle" },
];

export function SideNav({ activeRoute, onNavigate }: SideNavProps) {
  return (
    <aside className={styles.side} aria-label={t("common.menu")}>
      <div className={styles.logoSection}>
        <Icon n="store" s={28} />
        <span>{t("common.appName")}</span>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
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
