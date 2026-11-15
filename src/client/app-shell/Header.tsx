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
  onBack?: () => void;
}

export function Header({ onBack, ...menu }: HeaderProps) {
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
          className={styles.themeBtn}
          onClick={cycleTheme}
          aria-label={`الوضع: ${theme === "light" ? "فاتح" : theme === "dark" ? "داكن" : "تلقائي"}`}
          title="تغيير المظهر"
        >
          <Icon n={themeIcon} s={20} />
        </button>
      </div>
    </header>
  );
}
