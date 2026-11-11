"use client";

import React from "react";
import styles from "./Header.module.css";
import { Icon } from "../shared/ui";
import { t } from "../shared/i18n";
import { useTheme } from "../shared/theme";

export interface HeaderProps {
  storeName?: string;
  onStoreClick?: () => void;
  alertCount?: number;
  onNavigate?: (route: "alerts" | "ai") => void;
}

export function Header({
  storeName,
  onStoreClick,
  alertCount = 0,
  onNavigate,
}: HeaderProps) {
  const { theme, cycleTheme } = useTheme();

  const themeIcon =
    theme === "dark" ? "moon" : theme === "light" ? "sun" : "auto";
  const themeLabel =
    theme === "dark"
      ? t("common.themeDark")
      : theme === "light"
        ? t("common.themeLight")
        : t("common.themeAuto");

  const displayName = storeName || t("common.appName");

  return (
    <header className={styles.top}>
      <div className={styles.leftGroup}>
        <button
          type="button"
          className={styles.storeBtn}
          onClick={onStoreClick}
          aria-label={t("common.store")}
        >
          <div className={styles.storeIcon} aria-hidden="true">
            <Icon n="store" s={20} />
          </div>
          <span className={styles.storeName}>{displayName}</span>
          <Icon n="down" s={14} />
        </button>
      </div>

      <div className={styles.rightGroup}>
        {onNavigate && (
          <div className={styles.bellWrapper}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => onNavigate("alerts")}
              // Not the navigation's "التنبيهات": one name per control (QA-45).
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

        {onNavigate && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onNavigate("ai")}
            aria-label="المساعد الذكي"
            title="المساعد الذكي"
          >
            <Icon n="sparkle" s={20} />
          </button>
        )}

        <button
          type="button"
          className={styles.iconBtn}
          onClick={cycleTheme}
          aria-label={`${t("common.themeToggle")} (${themeLabel})`}
          title={`${t("common.themeToggle")} (${themeLabel})`}
        >
          <Icon n={themeIcon} s={20} />
        </button>
      </div>
    </header>
  );
}
