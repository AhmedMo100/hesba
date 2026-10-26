"use client";

import React from "react";
import styles from "./Seg.module.css";
import { Icon, type IconName } from "../Icon/Icon";

export type SegOption<T extends string = string> = [
  value: T,
  label: string,
  icon?: IconName,
];

export interface SegProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SegOption<T>[];
  size?: "sm" | "md" | "big";
  className?: string;
  ariaLabel?: string;
}

export function Seg<T extends string = string>({
  value,
  onChange,
  options,
  size = "md",
  className = "",
  ariaLabel,
}: SegProps<T>) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt[0] === value),
  );

  const styleVariables = {
    "--n": options.length,
    "--i": selectedIndex,
  } as React.CSSProperties;

  const classes = [styles.seg, size !== "md" ? styles[size] : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={styleVariables}
      role="tablist"
      aria-label={ariaLabel}
    >
      <i className={styles.thumb} aria-hidden="true" />
      {options.map(([optValue, optLabel, optIcon]) => {
        const isSelected = value === optValue;
        return (
          <button
            type="button"
            key={optValue}
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            className={`${styles.item} ${isSelected ? styles.on : ""}`}
            onClick={() => onChange(optValue)}
          >
            {optIcon && <Icon n={optIcon} s={16} />}
            <span>{optLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
