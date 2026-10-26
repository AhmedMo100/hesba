"use client";

import React, { useState, useEffect } from "react";
import styles from "./Header.module.css";
import { Icon } from "../shared/ui";
import { t } from "../shared/i18n";

export interface HeaderProps {
  storeName?: string;
  onStoreClick?: () => void;
}

export function Header({ storeName, onStoreClick }: HeaderProps) {
  const [theme, setTheme] = useState<"auto" | "light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("hesba-theme") as
        "auto" | "light" | "dark" | null;
      if (saved && ["auto", "light", "dark"].includes(saved)) {
        return saved;
      }
    }
    return "auto";
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const cycleTheme = () => {
    let next: "auto" | "light" | "dark" = "light";
    if (theme === "light") next = "dark";
    else if (theme === "dark") next = "auto";
    else next = "light";

    setTheme(next);
    localStorage.setItem("hesba-theme", next);
  };

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
        </button>
      </div>

      <div className={styles.rightGroup}>
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
