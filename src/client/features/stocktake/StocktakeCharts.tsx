"use client";

/**
 * @file StocktakeCharts.tsx
 * @description The stocktake's result, seen at a glance (ADR-0039). Three small charts, no
 * library — plain HTML bars, light on a phone:
 *
 * 1. «حالة الأصناف»: one bar split into مظبوط · زيادة · ناقص (products), each part labelled with
 *    its number, so colour is never the only cue (the colours pass the colour-blindness checks
 *    in both themes; red and green are never side by side).
 * 2. «المتوقع والموجود»: for the products with the biggest differences, what Hesba held next to
 *    what was counted — the same product, the same unit, so the two bars compare.
 * 3. «أسباب النقص»: how many products each reason explains.
 *
 * Everything comes from the server's count: nothing is estimated. The lists under the charts are
 * the table view. Hovering (or long-pressing) a bar shows its exact numbers.
 */
import React from "react";
import { formatBaseQty } from "@/client/shared/quantity";
import {
  stocktakeChartData,
  type StocktakeChartData,
  type StocktakeChartLine,
} from "@/domain/stocktake-charts";
import styles from "./StocktakeView.module.css";

export type ChartLine = StocktakeChartLine;

const pct = (part: number, whole: number) =>
  whole <= 0 ? 0 : Math.max(0, Math.min(100, (part / whole) * 100));

/** The charts of a count's lines (the «الجرد» screen). */
export function CountCharts({ lines }: { lines: ChartLine[] }) {
  return <StocktakeChartsView data={stocktakeChartData(lines)} />;
}

/** The same charts from ready data (also «اسأل حسبة»'s answer, built on the server). */
export function StocktakeChartsView({ data }: { data: StocktakeChartData }) {
  const s = data.status;
  const all = s.ok + s.over + s.short;
  if (all === 0) return null;
  const reasons = data.reasons;
  const maxReason = Math.max(1, ...reasons.map((r) => r.products));
  const big = data.pairs;

  return (
    <div className={styles.charts} data-testid="stocktake-charts">
      <section className={styles.chartCard} data-testid="chart-status">
        <h3 className={styles.chartTitle}>حالة الأصناف</h3>
        <div
          className={styles.stack}
          role="img"
          aria-label={`مظبوط ${s.ok}، زيادة ${s.over}، ناقص ${s.short}`}
        >
          {(
            [
              ["ok", s.ok, "مظبوط"],
              ["over", s.over, "زيادة"],
              ["short", s.short, "ناقص"],
            ] as const
          )
            .filter(([, n]) => n > 0)
            .map(([k, n, label]) => (
              <span
                key={k}
                className={`${styles.seg} ${styles[`seg_${k}`]}`}
                style={{ flexGrow: n }}
                title={`${label}: ${n} صنف`}
              />
            ))}
        </div>
        <div className={styles.legend}>
          {(
            [
              ["ok", s.ok, "مظبوط"],
              ["over", s.over, "زيادة"],
              ["short", s.short, "ناقص"],
            ] as const
          ).map(([k, n, label]) => (
            <span key={k}>
              <i className={styles[`seg_${k}`]} aria-hidden="true" />
              {label} <b>{n}</b>
            </span>
          ))}
        </div>
      </section>

      {big.length > 0 && (
        <section
          className={styles.chartCard}
          data-testid="chart-expected-actual"
        >
          <h3 className={styles.chartTitle}>المتوقع والموجود</h3>
          <div className={styles.legend}>
            <span>
              <i className={styles.barExpected} aria-hidden="true" />
              في حِسبة
            </span>
            <span>
              <i className={styles.seg_counted} aria-hidden="true" />
              اللي اتعدّ
            </span>
          </div>
          <div className={styles.pairs}>
            {big.map((l) => {
              const max = Math.max(l.expectedBase, l.countedBase, 1);
              return (
                <div key={l.name} className={styles.pairRow}>
                  <span className={styles.pairName}>{l.name}</span>
                  <span
                    className={styles.barTrack}
                    title={`في حِسبة: ${formatBaseQty(l.unit, l.expectedBase)}`}
                  >
                    <span
                      className={`${styles.bar} ${styles.barExpected}`}
                      style={{ width: `${pct(l.expectedBase, max)}%` }}
                    />
                    <b>{formatBaseQty(l.unit, l.expectedBase)}</b>
                  </span>
                  <span
                    className={styles.barTrack}
                    title={`اللي اتعدّ: ${formatBaseQty(l.unit, l.countedBase)}`}
                  >
                    <span
                      className={`${styles.bar} ${styles.seg_counted}`}
                      style={{ width: `${pct(l.countedBase, max)}%` }}
                    />
                    <b>{formatBaseQty(l.unit, l.countedBase)}</b>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {reasons.length > 0 && (
        <section className={styles.chartCard} data-testid="chart-reasons">
          <h3 className={styles.chartTitle}>أسباب النقص</h3>
          <div className={styles.pairs}>
            {reasons.map((r) => (
              <div key={r.reason} className={styles.reasonBarRow}>
                <span className={styles.pairName}>{r.label}</span>
                <span
                  className={styles.barTrack}
                  title={`${r.label}: ${r.products} صنف`}
                >
                  <span
                    className={`${styles.bar} ${styles.seg_short}`}
                    style={{ width: `${pct(r.products, maxReason)}%` }}
                  />
                  <b>{r.products}</b>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
