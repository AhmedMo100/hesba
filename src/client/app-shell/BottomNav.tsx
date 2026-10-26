"use client";

import React, { useState } from "react";
import styles from "./BottomNav.module.css";
import { Icon, Modal } from "../shared/ui";
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

export function BottomNav({ activeRoute, onNavigate }: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = ["expenses", "people", "alerts", "ai"].includes(
    activeRoute,
  );

  const handleMoreItemClick = (route: NavRoute) => {
    onNavigate(route);
    setMoreOpen(false);
  };

  return (
    <>
      <nav className={styles.bnav} aria-label={t("common.menu")}>
        <button
          type="button"
          className={`${styles.bn} ${activeRoute === "home" ? styles.on : ""}`}
          onClick={() => onNavigate("home")}
          aria-label={t("nav.home")}
        >
          <span className={styles.iconWrapper}>
            <Icon n="home" s={22} />
          </span>
          <span>{t("nav.home")}</span>
        </button>

        <button
          type="button"
          className={`${styles.bn} ${activeRoute === "products" ? styles.on : ""}`}
          onClick={() => onNavigate("products")}
          aria-label={t("nav.products")}
        >
          <span className={styles.iconWrapper}>
            <Icon n="box" s={22} />
          </span>
          <span>{t("nav.products")}</span>
        </button>

        <button
          type="button"
          className={`${styles.bn} ${styles.sell}`}
          onClick={() => onNavigate("sales")}
          aria-label={t("nav.sales")}
        >
          <div className={styles.sellCircle}>
            <Icon n="cart" s={26} />
          </div>
          <span>{t("nav.sales")}</span>
        </button>

        <button
          type="button"
          className={`${styles.bn} ${activeRoute === "stock" ? styles.on : ""}`}
          onClick={() => onNavigate("stock")}
          aria-label={t("nav.stock")}
        >
          <span className={styles.iconWrapper}>
            <Icon n="layers" s={22} />
          </span>
          <span>{t("nav.stock")}</span>
        </button>

        <button
          type="button"
          className={`${styles.bn} ${isMoreActive ? styles.on : ""}`}
          onClick={() => setMoreOpen(true)}
          aria-label={t("nav.more")}
        >
          <span className={styles.iconWrapper}>
            <Icon n="more" s={22} />
          </span>
          <span>{t("nav.more")}</span>
        </button>
      </nav>

      {moreOpen && (
        <Modal title={t("nav.more")} onClose={() => setMoreOpen(false)}>
          <div className={styles.moreGrid}>
            <button
              type="button"
              className={styles.moreItem}
              onClick={() => handleMoreItemClick("expenses")}
            >
              <div className={styles.moreIcon}>
                <Icon n="wallet" s={26} />
              </div>
              <span>{t("nav.expenses")}</span>
            </button>

            <button
              type="button"
              className={styles.moreItem}
              onClick={() => handleMoreItemClick("people")}
            >
              <div className={styles.moreIcon}>
                <Icon n="users" s={26} />
              </div>
              <span>{t("nav.people")}</span>
            </button>

            <button
              type="button"
              className={styles.moreItem}
              onClick={() => handleMoreItemClick("alerts")}
            >
              <div className={styles.moreIcon}>
                <Icon n="bell" s={26} />
              </div>
              <span>{t("nav.alerts")}</span>
            </button>

            <button
              type="button"
              className={styles.moreItem}
              onClick={() => handleMoreItemClick("ai")}
            >
              <div className={styles.moreIcon}>
                <Icon n="sparkle" s={26} />
              </div>
              <span>{t("nav.ai")}</span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
