"use client";

/**
 * @file DrawerView.tsx
 * @description The cash drawer (V19, ADR-0031): what should be in it now (the last count
 * plus the cash that moved since), the owner's count with its difference, and where the
 * drawer's cash came from and went to since the last count. Movements whose source was not
 * recorded are listed apart and never counted. No count yet → no expected amount.
 */

import React, { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import {
  countDrawer,
  fetchDrawer,
  type DrawerFlow,
  type DrawerView as Drawer,
} from "@/client/shared/api/drawer";
import styles from "./HomeView.module.css";

const FLOW_LABEL: Record<DrawerFlow["key"], string> = {
  cashSales: "💵 بيع كاش",
  collections: "🤝 تحصيل من الزباين",
  refunds: "↩️ مرتجعات اترجعت كاش",
  voids: "🚫 بيعات اتلغت",
  expenses: "💸 مصروفات من الدرج",
  supplierPayments: "🚚 دفعت للموردين",
  stockPurchases: "📦 بضاعة اتدفعت من الدرج",
  machineTopups: "💳 رصيد للماكينات",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));

export function DrawerView() {
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [failed, setFailed] = useState(false);
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const opRef = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchDrawer()
      .then((d) => alive && setDrawer(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const countedPiasters =
    counted.trim() === "" ? null : parseEgpStrict(counted);
  const expected = drawer?.expectedPiasters ?? null;
  const diff =
    countedPiasters === null || expected === null
      ? null
      : countedPiasters - expected;

  const submit = async () => {
    if (countedPiasters === null) {
      setError("اكتب المبلغ اللي عدّيته");
      return;
    }
    setBusy(true);
    setError(null);
    const key = `${countedPiasters}|${drawer?.lastCount?.countedAt ?? ""}`;
    if (opRef.current?.key !== key) {
      opRef.current = { key, id: crypto.randomUUID() };
    }
    try {
      const next = await countDrawer(opRef.current.id, countedPiasters);
      opRef.current = null;
      setDrawer(next);
      setCounted("");
      setDone(
        diff === null
          ? "اتسجل العدّ ✅ — من دلوقتي هنحسب الدرج"
          : diff === 0
            ? "اتقفل الدرج، مطابق ✅"
            : `اتقفل الدرج، والفرق ${diff > 0 ? "+" : ""}${formatMoney(diff)}`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "مقدرناش نسجّل العدّ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page} data-testid="page-drawer" dir="rtl">
      <h2 className={styles.h2}>الدرج</h2>

      {failed && !drawer ? (
        <div className={styles.warn} role="alert">
          مقدرناش نجيب حساب الدرج — الدرج محتاج نت
        </div>
      ) : (
        <>
          <div className={styles.bigBox}>
            <small>
              {drawer && !drawer.lastCount
                ? "لسه ما عدّيتش الدرج"
                : "المفروض يكون في الدرج دلوقتي"}
            </small>
            <b data-testid="drawer-expected">
              {!drawer ? (
                <Skeleton width={120} height={36} />
              ) : expected === null ? (
                "—"
              ) : (
                formatMoney(expected)
              )}
            </b>
          </div>
          {drawer && !drawer.lastCount && (
            <div className={styles.note}>
              عدّ الفلوس اللي في الدرج دلوقتي وسجّلها. من بعدها حِسبة هتحسب
              المفروض يكون فيه من البيع الكاش والمصروفات والمدفوعات.
            </div>
          )}

          <label className={styles.lbl} htmlFor="drawer-count">
            عدّيت كام فعلاً؟
          </label>
          <input
            id="drawer-count"
            className={styles.input}
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0"
            value={counted}
            onChange={(e) => {
              setCounted(e.target.value);
              setDone(null);
            }}
            data-testid="drawer-count"
          />
          {diff !== null && (
            <div className={styles.sumbox}>
              <div className={styles.line}>
                <span>الفرق</span>
                <b
                  data-testid="drawer-diff"
                  className={diff === 0 ? styles.goodText : styles.redText}
                >
                  {diff === 0
                    ? "مطابق ✅"
                    : `${diff > 0 ? "+" : ""}${formatMoney(diff)}`}
                </b>
              </div>
            </div>
          )}
          {diff !== null && diff !== 0 && (
            <div className={styles.note}>
              لو ناقص: شوف اللي تحت. غالباً مصروف ما اتسجلش، أو فكة، أو بيع كاش
              ما اتسجلش.
            </div>
          )}
          {error && (
            <div className={styles.warn} role="alert">
              {error}
            </div>
          )}
          {done && (
            <div
              className={styles.note}
              role="status"
              data-testid="drawer-done"
            >
              {done}
            </div>
          )}
          <button
            type="button"
            className={styles.btn}
            disabled={busy || !drawer || countedPiasters === null}
            onClick={() => void submit()}
            data-testid="drawer-close"
          >
            {busy
              ? "بيتسجّل…"
              : drawer && !drawer.lastCount
                ? "سجّل أول عدّ"
                : "قفل الدرج"}
          </button>

          {drawer?.lastCount && (
            <>
              <h3 className={styles.sech}>من آخر عدّ</h3>
              <div className={styles.sumbox} data-testid="drawer-flows">
                <div className={styles.line}>
                  <span>
                    الفلوس وقت آخر عدّ{" "}
                    <small className={styles.muted}>
                      ({when(drawer.lastCount.countedAt)})
                    </small>
                  </span>
                  <b>{formatMoney(drawer.lastCount.countedPiasters)}</b>
                </div>
                {drawer.flows
                  .filter((f) => f.count > 0)
                  .map((f) => (
                    <div key={f.key} className={styles.line}>
                      <span>
                        {FLOW_LABEL[f.key]}{" "}
                        <small className={styles.muted}>({f.count})</small>
                      </span>
                      <b
                        className={
                          f.direction === "in"
                            ? styles.goodText
                            : styles.redText
                        }
                      >
                        {f.direction === "in" ? "+" : "−"}
                        {formatMoney(f.amountPiasters)}
                      </b>
                    </div>
                  ))}
                <div className={styles.line}>
                  <b>داخل كاش / خارج كاش</b>
                  <b>
                    {formatMoney(drawer.inPiasters)} /{" "}
                    {formatMoney(drawer.outPiasters)}
                  </b>
                </div>
              </div>
              {drawer.unknown.count > 0 && (
                <div className={styles.warn} data-testid="drawer-unknown">
                  ⚠️ {drawer.unknown.count} حركة بـ{" "}
                  {formatMoney(drawer.unknown.amountPiasters)} مش متسجل اتدفعت
                  من الدرج ولا من محفظة، فمش داخلة في الحساب.
                </div>
              )}
            </>
          )}

          {drawer && drawer.recentCounts.length > 0 && (
            <>
              <h3 className={styles.sech}>آخر مرات العدّ</h3>
              <div className={styles.sumbox}>
                {drawer.recentCounts.map((c) => {
                  const d =
                    c.expectedPiasters === null
                      ? null
                      : c.countedPiasters - c.expectedPiasters;
                  return (
                    <div key={c.countedAt} className={styles.line}>
                      <span>{when(c.countedAt)}</span>
                      <b>
                        {formatMoney(c.countedPiasters)}
                        {d !== null && d !== 0 && (
                          <small className={styles.redText}>
                            {" "}
                            ({d > 0 ? "+" : ""}
                            {formatMoney(d)})
                          </small>
                        )}
                      </b>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default DrawerView;
