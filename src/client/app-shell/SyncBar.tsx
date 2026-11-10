"use client";

/**
 * @file SyncBar.tsx
 * @description The connection/sync status strip under the header.
 *
 * @remarks
 * Purely presentational: it renders the `state` and `pendingCount` it is given. `AppShell`
 * derives both from the browser's connection and the sales outbox (ADR-0020): "synced" only
 * when no sale is waiting or needs review.
 */

import React from "react";
import styles from "./SyncBar.module.css";
import { Icon } from "../shared/ui";
import { t } from "../shared/i18n";

export type SyncState =
  "synced" | "syncing" | "offline" | "login" | "updating" | "needsReview";

export interface SyncBarProps {
  state?: SyncState;
  pendingCount?: number;
  className?: string;
  onClick?: () => void;
}

export function SyncBar({
  state = "synced",
  pendingCount = 0,
  className = "",
  onClick,
}: SyncBarProps) {
  let text = t("sync.synced");
  let iconName: "check" | "refresh" | "wifioff" | "alert" = "check";

  if (state === "syncing") {
    text =
      pendingCount > 0
        ? t("sync.syncing", { count: pendingCount })
        : t("sync.syncingPlain");
    iconName = "refresh";
  } else if (state === "offline") {
    text = t("sync.offline", { count: pendingCount });
    iconName = "wifioff";
  } else if (state === "login") {
    text = t("sync.login");
    iconName = "alert";
  } else if (state === "updating") {
    text = t("sync.updating");
    iconName = "refresh";
  } else if (state === "needsReview") {
    text = t("sync.needsReview", { count: pendingCount });
    iconName = "alert";
  }

  const classes = [styles.syncbar, styles[state], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status" aria-live="polite" onClick={onClick}>
      <Icon
        n={iconName}
        s={16}
        className={
          state === "syncing" || state === "updating" ? styles.spin : undefined
        }
      />
      <span>{text}</span>
    </div>
  );
}
