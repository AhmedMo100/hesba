"use client";

import React from "react";
import styles from "./Field.module.css";
import { normDigits } from "../../i18n";
import { Icon } from "../Icon/Icon";

export interface FieldProps {
  label: string;
  hint?: string;
  err?: string;
  grow?: boolean;
  div?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  hint,
  err,
  grow = false,
  div = false,
  children,
  className = "",
}: FieldProps) {
  const Tag = div ? "div" : "label";
  const classes = [
    styles.fld,
    err ? styles.bad : "",
    grow ? styles.grow : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag className={classes}>
      <span className={styles.fl}>{label}</span>
      {children}
      {err ? (
        <span className={styles.fe} role="alert" aria-live="polite">
          <Icon n="alert" s={14} sw={2.4} className={styles.feIcon} />
          <span>{err}</span>
        </span>
      ) : hint ? (
        <span className={styles.fh}>{hint}</span>
      ) : null}
    </Tag>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  className?: string;
}

export function Input({ className = "", ...rest }: InputProps) {
  return <input className={`${styles.input} ${className}`} {...rest} />;
}

export interface NumProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange"
> {
  value: string | number;
  onChange: (value: string) => void;
  suffix?: string;
  placeholder?: string;
}

export function Num({
  value,
  onChange,
  suffix,
  placeholder = "0",
  className = "",
  ...rest
}: NumProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const normalized = normDigits(raw).replace(/[^\d.]/g, "");
    onChange(normalized);
  };

  return (
    <div className={styles.num}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={`${styles.numInput} ${className}`}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onFocus={(e) => e.target.select()}
        {...rest}
      />
      {suffix && <span className={styles.sfx}>{suffix}</span>}
    </div>
  );
}
