"use client";

/**
 * @file PeriodFilter.tsx
 * @description The one period filter of the app: preset chips (the shared `Chip`) and, for
 * «فترة مخصصة», a specific day or a from → to range. Screens pass their own presets; the
 * look, spacing and behaviour are the same everywhere.
 */

import React, { useState } from "react";
import { Chip, Chips } from "../Chips/Chips";
import { Seg } from "../Seg/Seg";
import styles from "./PeriodFilter.module.css";

export interface PeriodFilterProps<K extends string> {
  options: ReadonlyArray<readonly [K, string]>;
  value: K;
  onChange: (value: K) => void;
  /** The option key that opens the date pickers (e.g. "custom"). */
  customKey?: K;
  from?: string;
  to?: string;
  onRangeChange?: (from: string, to: string) => void;
  /** Latest selectable day (`YYYY-MM-DD`), e.g. today. */
  max?: string;
  ariaLabel?: string;
}

export function PeriodFilter<K extends string>({
  options,
  value,
  onChange,
  customKey,
  from = "",
  to = "",
  onRangeChange,
  max,
  ariaLabel = "الفترة",
}: PeriodFilterProps<K>) {
  const isCustom = customKey !== undefined && value === customKey;
  // One day or a range: the owner's choice (kept even while the range equals one day).
  const [mode, setMode] = useState<"day" | "range">(
    to && to !== from ? "range" : "day",
  );
  const single = mode === "day";
  return (
    <div className={styles.wrap}>
      <Chips role="tablist">
        {options.map(([key, label]) => (
          <Chip
            key={key}
            role="tab"
            aria-selected={value === key}
            active={value === key}
            onClick={() => onChange(key)}
            data-testid={`period-${key}`}
          >
            {label}
          </Chip>
        ))}
      </Chips>
      {isCustom && onRangeChange && (
        <div className={styles.custom} aria-label={ariaLabel}>
          <Seg<"day" | "range">
            size="sm"
            value={mode}
            onChange={(m) => {
              setMode(m);
              if (m === "day") onRangeChange(from, from);
            }}
            options={[
              ["day", "يوم معيّن"],
              ["range", "من … إلى"],
            ]}
          />
          <div className={styles.dates}>
            <label className={styles.date}>
              <span>{single ? "اليوم" : "من"}</span>
              <input
                type="date"
                value={from}
                max={max}
                data-testid="period-from"
                onChange={(e) =>
                  onRangeChange(e.target.value, single ? e.target.value : to)
                }
              />
            </label>
            {!single && (
              <label className={styles.date}>
                <span>إلى</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  max={max}
                  data-testid="period-to"
                  onChange={(e) => onRangeChange(from, e.target.value)}
                />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
