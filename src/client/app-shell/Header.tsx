"use client";

import React from "react";
import styles from "./Header.module.css";
import { Icon, type IconName } from "../shared/ui";
import { StoreMenu, type StoreMenuProps } from "./StoreMenu";
import { useTheme, type ThemeMode } from "../shared/theme";

const THEME_ICON: Record<ThemeMode, IconName> = {
  light: "sun",
  dark: "moon",
  auto: "auto",
};

export interface HeaderProps extends StoreMenuProps {
  alertCount?: number;
  onOpenAlerts?: () => void;
  onBack?: () => void;
}

export function Header({
  alertCount = 0,
  onOpenAlerts,
  onBack,
  ...menu
}: HeaderProps) {
  const { theme, cycleTheme } = useTheme();
  const themeIcon = THEME_ICON[theme] ?? "sun";

  return (
    <header className={styles.top}>
      <div className={styles.leftGroup}>
        {onBack && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onBack}
            aria-label="رجوع"
          >
            <Icon n="left" s={20} />
          </button>
        )}
        <StoreMenu {...menu} />
      </div>

      <div className={styles.spacer} />

      <div className={styles.rightGroup}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={cycleTheme}
          aria-label={`الوضع: ${theme === "light" ? "فاتح" : theme === "dark" ? "داكن" : "تلقائي"}`}
          title="تغيير المظهر"
        >
          <Icon n={themeIcon} s={20} />
        </button>

        {onOpenAlerts && (
          <div className={styles.bellWrapper}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onOpenAlerts}
              aria-label={
                alertCount > 0
                  ? `جرس التنبيهات (${alertCount})`
                  : "جرس التنبيهات"
              }
              title="التنبيهات"
            >
              <Icon n="bell" s={20} />
            </button>
            {alertCount > 0 && (
              <span className={styles.bellBadge}>
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
