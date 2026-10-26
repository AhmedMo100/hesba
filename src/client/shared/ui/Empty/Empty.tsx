import React from "react";
import styles from "./Empty.module.css";
import { Icon, type IconName } from "../Icon/Icon";

export interface EmptyProps {
  icon?: IconName;
  title: string;
  sub?: string;
  action?: React.ReactNode;
  className?: string;
}

export function Empty({
  icon = "box",
  title,
  sub,
  action,
  className = "",
}: EmptyProps) {
  return (
    <div className={`${styles.empty} ${className}`}>
      <div className={styles.eIcon} aria-hidden="true">
        <Icon n={icon} s={28} />
      </div>
      <b className={styles.title}>{title}</b>
      {sub && <span className={styles.sub}>{sub}</span>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
