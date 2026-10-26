import React from "react";
import styles from "./Chips.module.css";
import { Icon, type IconName } from "../Icon/Icon";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: "md" | "lg";
  isStatic?: boolean;
  icon?: IconName;
  children: React.ReactNode;
}

export function Chip({
  active = false,
  size = "md",
  isStatic = false,
  icon,
  children,
  className = "",
  ...rest
}: ChipProps) {
  const classes = [
    styles.chip,
    active ? styles.on : "",
    size === "lg" ? styles.lg : "",
    isStatic ? styles.static : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      role={isStatic ? undefined : "button"}
      aria-pressed={isStatic ? undefined : active}
      {...rest}
    >
      {icon && <Icon n={icon} s={16} />}
      <span>{children}</span>
    </button>
  );
}

export interface ChipsProps {
  tight?: boolean;
  center?: boolean;
  children: React.ReactNode;
  className?: string;
  role?: string;
}

export function Chips({
  tight = false,
  center = false,
  children,
  className = "",
  role,
}: ChipsProps) {
  const classes = [
    styles.chips,
    tight ? styles.tight : "",
    center ? styles.center : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={role}>
      {children}
    </div>
  );
}
