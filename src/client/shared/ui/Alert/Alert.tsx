"use client";

import React from "react";
import styles from "./Alert.module.css";
import { Icon, type IconName } from "../Icon/Icon";

export type AlertKind = "error" | "success" | "warning" | "info";

export interface AlertProps {
  kind?: AlertKind;
  title?: string;
  icon?: IconName | false;
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
  role?: string;
  ariaLive?: "assertive" | "polite" | "off";
}

const DEFAULT_ICONS: Record<AlertKind, IconName> = {
  error: "alert",
  success: "check",
  warning: "alert",
  info: "info",
};

export function Alert({
  kind = "error",
  title,
  icon,
  children,
  className = "",
  onClose,
  role,
  ariaLive,
}: AlertProps) {
  const chosenIcon = icon !== false ? (icon ?? DEFAULT_ICONS[kind]) : null;
  const computedRole =
    role ?? (kind === "error" || kind === "warning" ? "alert" : "status");
  const computedAriaLive =
    ariaLive ?? (kind === "error" ? "assertive" : "polite");

  const alertClasses = [styles.alert, styles[kind], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={alertClasses}
      role={computedRole}
      aria-live={computedAriaLive}
    >
      {chosenIcon && (
        <span className={styles.icon} aria-hidden="true">
          <Icon n={chosenIcon} s={18} sw={2.4} />
        </span>
      )}

      <div className={styles.content}>
        {title && <div className={styles.title}>{title}</div>}
        <div className={styles.bodyText}>{children}</div>
      </div>

      {onClose && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="إغلاق التنبيه"
        >
          <Icon n="x" s={16} sw={2.2} />
        </button>
      )}
    </div>
  );
}
