"use client";

import React from "react";
import styles from "./BottomNav.module.css";
import { Icon, type IconName } from "../shared/ui";
import { t } from "../shared/i18n";

export type NavRoute =
  | "home"
  | "products"
  | "sales"
  | "stock"
  | "expenses"
  | "people"
  | "alerts"
  | "ai";

export interface BottomNavProps {
  activeRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
}

type Item = { route: NavRoute; icon: IconName };

/**
 * Six screens around the central «البيع» action. RTL: the first three sit on the right
 * (start), the last three on the left. Alerts are reached from the top bar's bell.
 */
const START: Item[] = [
  { route: "home", icon: "home" },
  { route: "products", icon: "box" },
  { route: "stock", icon: "layers" },
];
const END: Item[] = [
  { route: "expenses", icon: "wallet" },
  { route: "people", icon: "users" },
  { route: "ai", icon: "sparkle" },
];

export function BottomNav({ activeRoute, onNavigate }: BottomNavProps) {
  const item = ({ route, icon }: Item) => {
    const on = activeRoute === route;
    return (
      <button
        type="button"
        key={route}
        className={`${styles.bn} ${on ? styles.on : ""}`}
        onClick={() => onNavigate(route)}
        aria-current={on ? "page" : undefined}
        data-testid={`bnav-${route}`}
      >
        <span className={styles.iconWrapper}>
          <Icon n={icon} s={22} />
        </span>
        <span className={styles.label}>{t(`nav.${route}`)}</span>
      </button>
    );
  };

  return (
    <nav className={styles.bnav} aria-label={t("common.menu")}>
      {START.map(item)}
      <button
        type="button"
        className={`${styles.bn} ${styles.sell}`}
        onClick={() => onNavigate("sales")}
        aria-current={activeRoute === "sales" ? "page" : undefined}
        data-testid="bnav-sales"
      >
        <div className={styles.sellCircle}>
          <Icon n="cart" s={26} />
        </div>
        <span className={styles.label}>{t("nav.sales")}</span>
      </button>
      {END.map(item)}
    </nav>
  );
}
