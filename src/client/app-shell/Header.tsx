"use client";

import React from "react";
import styles from "./Header.module.css";
import { StoreMenu, type StoreMenuProps } from "./StoreMenu";
import { useTheme, type ThemeMode } from "../shared/theme";
import { t } from "../shared/i18n";
import type { NavRoute } from "./BottomNav";

const THEME_GLYPH: Record<ThemeMode, string> = {
  light: "🌙",
  dark: "☀️",
  auto: "🌓",
};

const PAGE_TITLE: Partial<Record<NavRoute, string>> = {
  stock: "pageTitle.stock",
  sales: "pageTitle.sales",
  "daily-sales": "pageTitle.dailySales",
  expenses: "pageTitle.expenses",
  people: "pageTitle.people",
  alerts: "pageTitle.alerts",
  products: "pageTitle.products",
  ai: "pageTitle.ai",
  inventory: "pageTitle.inventory",
  reports: "pageTitle.reports",
  drawer: "pageTitle.drawer",
  notifications: "pageTitle.notifications",
};

export interface HeaderProps extends StoreMenuProps {
  onBack?: () => void;
  route?: NavRoute;
}

export function Header({ onBack, route, ...menu }: HeaderProps) {
  const { theme, cycleTheme } = useTheme();
  const themeGlyph = THEME_GLYPH[theme] ?? "🌙";

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
            <span aria-hidden="true">→</span>
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
          <span aria-hidden="true">{themeGlyph}</span>
        </button>
      </div>
    </header>
  );
}
