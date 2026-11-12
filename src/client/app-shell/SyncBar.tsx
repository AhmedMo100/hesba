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

/** What the bar needs to know about one queued sale. */
export interface QueuedOpStatus {
  status: string;
  /** HTTP status of the last attempt (0 = network), null before the first attempt. */
  last_status?: number | null;
}

/**
 * The bar's state from the connection and the sales outbox (QA-17). "synced" only when the
 * queue is known and nothing waits or needs review. A waiting sale whose last answer was a
 * 401 asks to log in, a 503 says the server is updating (the sale is safe in the outbox),
 * any other failure keeps "syncing" with the count — never a false "synced".
 */
export function deriveSyncState(input: {
  online: boolean;
  sessionExpired: boolean;
  /** Undefined until IndexedDB has answered. */
  queue: readonly QueuedOpStatus[] | undefined;
}): { state: SyncState; pendingCount: number } {
  const queue = input.queue ?? [];
  const waiting = queue.filter(
    (o) => o.status === "pending" || o.status === "sending",
  );
  const review = queue.filter(
    (o) => o.status === "rejected" || o.status === "quarantined",
  );
  const pendingCount = waiting.length + review.length;
  const lastWas = (code: number) => waiting.some((o) => o.last_status === code);

  let state: SyncState;
  if (input.sessionExpired || (input.online && lastWas(401))) state = "login";
  else if (!input.online) state = "offline";
  else if (review.length > 0) state = "needsReview";
  else if (lastWas(503)) state = "updating";
  else if (waiting.length > 0 || input.queue === undefined) state = "syncing";
  else state = "synced";
  return { state, pendingCount };
}

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
