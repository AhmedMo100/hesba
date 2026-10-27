"use client";

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
    text = t("sync.syncing");
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
    text = t("sync.needsReview");
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
