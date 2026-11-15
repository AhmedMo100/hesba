"use client";

import React from "react";
import styles from "./Header.module.css";
import { Icon, type IconName } from "../shared/ui";
import { StoreMenu, type StoreMenuProps } from "./StoreMenu";
import { useTheme, type ThemeMode } from "../shared/theme";
import { t } from "../shared/i18n";
import type { NavRoute } from "./BottomNav";

const THEME_ICON: Record<ThemeMode, IconName> = {
  light: "sun",
  dark: "moon",
  auto: "auto",
};

const PAGE_TITLE: Partial<Record<NavRoute, string>> = {
  stock: "pageTitle.stock",
  sales: "pageTitle.sales",
  expenses: "pageTitle.expenses",
  people: "pageTitle.people",
  alerts: "pageTitle.alerts",
  products: "pageTitle.products",
  ai: "pageTitle.ai",
  inventory: "pageTitle.inventory",
};

export interface HeaderProps extends StoreMenuProps {
  onBack?: () => void;
  route?: NavRoute;
  alertCount?: number;
  onOpenAlerts?: () => void;
}

export function Header({
  onBack,
  route,
  alertCount = 0,
  onOpenAlerts,
  ...menu
}: HeaderProps) {
  const { theme, cycleTheme } = useTheme();
  const themeIcon = THEME_ICON[theme] ?? "sun";

  const isHome = !route || route === "home";
  const titleKey = route ? PAGE_TITLE[route] : undefined;
  const pageTitle = titleKey ? t(titleKey) : undefined;

  return (
    <header className={styles.top}>
      <div className={styles.rightGroup}>
        {!isHome && onBack && (
          <button
            type="button"
            className={styles.backBtn}
            onClick={onBack}
            aria-label="رجوع للرئيسية"
          >
            <Icon n="left" s={20} />
          </button>
        )}
        <StoreMenu {...menu} pageTitle={pageTitle} />
      </div>

      <div className={styles.spacer} />

      <div className={styles.leftGroup}>
        <button
          type="button"
          className={styles.themeBtn}
          onClick={cycleTheme}
          aria-label={`الوضع: ${theme === "light" ? "فاتح" : theme === "dark" ? "داكن" : "تلقائي"}`}
          title="تغيير المظهر"
        >
          <Icon n={themeIcon} s={20} />
        </button>
        {onOpenAlerts && (
          <button
            type="button"
            className={styles.bellBtn}
            onClick={onOpenAlerts}
            aria-label="التنبيهات"
          >
            <Icon n="bell" s={20} />
            {alertCount > 0 && (
              <span className={styles.bellBadge}>
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
