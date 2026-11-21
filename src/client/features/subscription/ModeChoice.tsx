"use client";

/**
 * @file ModeChoice.tsx
 * @description The choice between إدارة المحل and الكاشير الذكي (ADR-0033), in words a shop owner
 * understands: what each one does and does not do. Nothing is chosen until the owner taps one.
 * Used on the sign-up screen and in the shop's settings.
 */
import React from "react";
import type { OperatingMode } from "@/domain/operating-mode";
import styles from "./ModeChoice.module.css";

const MODES: Array<{
  mode: OperatingMode;
  em: string;
  name: string;
  desc: string;
  yes: string[];
  no: string[];
  badge?: string;
}> = [
  {
    mode: "simple",
    em: "📒",
    name: "إدارة المحل",
    desc: "تتابع فلوس المحل وبضاعته من غير ما تسجّل كل بيعة. آخر اليوم بتكتب إجمالي اللي بعته.",
    yes: [
      "البضاعة والمخزون والجرد",
      "المشتريات والمصروفات",
      "الزباين والموردين والديون",
      "الدرج والمحافظ والماكينات",
      "إجمالي مبيعات اليوم (كاش ومحافظ)",
    ],
    no: ["من غير كاشير ولا فواتير بيع لكل زبون"],
  },
  {
    mode: "pos",
    em: "🧾",
    name: "الكاشير الذكي",
    desc: "كل حاجة في إدارة المحل، وكمان كاشير تبيع منه بالباركود أو بالبحث، وكل بيعة بتتسجل بمنتجاتها.",
    yes: [
      "كل مميزات إدارة المحل",
      "كاشير بالباركود والبحث",
      "فاتورة لكل بيعة، والمخزون بيتخصم لوحده",
      "البيع الآجل والمرتجعات",
      "تقارير مبيعات ومكسب لكل منتج",
    ],
    no: [],
    badge: "متابعة تفصيلية للمبيعات",
  },
];

export function ModeChoice({
  value,
  onChange,
  error,
  disabled,
}: {
  value: OperatingMode | null;
  onChange: (mode: OperatingMode) => void;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <div
        className={styles.choice}
        role="radiogroup"
        aria-label="طريقة تشغيل المحل"
        data-testid="mode-choice"
      >
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={value === m.mode}
            className={`${styles.card} ${value === m.mode ? styles.on : ""}`}
            onClick={() => onChange(m.mode)}
            disabled={disabled}
            data-testid={`mode-${m.mode}`}
          >
            <span className={styles.head}>
              <span className={styles.em} aria-hidden="true">
                {m.em}
              </span>
              <span className={styles.name}>{m.name}</span>
              {m.badge && <span className={styles.badge}>{m.badge}</span>}
            </span>
            <span className={styles.desc}>{m.desc}</span>
            <ul className={styles.list}>
              {m.yes.map((y) => (
                <li key={y}>{y}</li>
              ))}
              {m.no.map((n) => (
                <li key={n} className={styles.no}>
                  {n}
                </li>
              ))}
            </ul>
            {value === m.mode && (
              <span className={styles.check} aria-hidden="true">
                ✅
              </span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <div className={styles.err} role="alert" data-testid="mode-error">
          {error}
        </div>
      )}
    </div>
  );
}
