"use client";

/**
 * @file Header.tsx
 * @description The top bar: the shop menu (Hesba logo, shop name, the theme and account
 * controls inside it) and the notifications bell. The theme control and the assistant moved
 * out of the bar (the theme into the shop menu, the assistant into the bottom navigation).
 */

import React from "react";
import styles from "./Header.module.css";
import { Icon } from "../shared/ui";
import { StoreMenu, type StoreMenuProps } from "./StoreMenu";

export interface HeaderProps extends StoreMenuProps {
  alertCount?: number;
  onOpenAlerts?: () => void;
}

export function Header({ alertCount = 0, onOpenAlerts, ...menu }: HeaderProps) {
  return (
    <header className={styles.top}>
      <div className={styles.leftGroup}>
        <StoreMenu {...menu} />
      </div>

      <div className={styles.rightGroup}>
        {onOpenAlerts && (
          <div className={styles.bellWrapper}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onOpenAlerts}
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
      </div>
    </header>
  );
}
