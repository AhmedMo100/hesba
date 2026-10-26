"use client";

import React from "react";
import styles from "./SyncBar.module.css";
import { Icon } from "../shared/ui";
import { t } from "../shared/i18n";

export type SyncState = "synced" | "syncing" | "offline";

export interface SyncBarProps {
  state?: SyncState;
  pendingCount?: number;
  className?: string;
}

export function SyncBar({
  state = "synced",
  pendingCount = 0,
  className = "",
}: SyncBarProps) {
  let text = t("sync.synced");
  let iconName: "check" | "refresh" | "wifioff" = "check";

  if (state === "syncing") {
    text = t("sync.syncing");
    iconName = "refresh";
  } else if (state === "offline") {
    text = t("sync.offline", { count: pendingCount });
    iconName = "wifioff";
  }

  const classes = [styles.syncbar, styles[state], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status" aria-live="polite">
      <Icon
        n={iconName}
        s={16}
        className={state === "syncing" ? styles.spin : undefined}
      />
      <span>{text}</span>
    </div>
  );
}
