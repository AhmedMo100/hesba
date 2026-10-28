import React from "react";
import styles from "./Button.module.css";
import { Icon, type IconName } from "../Icon/Icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: "primary" | "ghost" | "soft" | "danger" | "dangerghost";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  wide?: boolean;
  loading?: boolean;
  busy?: boolean;
  children?: React.ReactNode;
}

export function Button({
  kind = "primary",
  size = "md",
  icon,
  wide = false,
  loading = false,
  busy = false,
  disabled,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  const isLoading = loading || busy;
  const classes = [
    styles.btn,
    styles[kind],
    size !== "md" ? styles[size] : "",
    wide ? styles.wide : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      disabled={disabled || isLoading}
      {...rest}
    >
      {isLoading ? (
        <Icon n="refresh" s={18} className={styles.spin} />
      ) : icon ? (
        <Icon n={icon} s={size === "sm" ? 16 : 18} />
      ) : null}
      {children}
    </button>
  );
}
