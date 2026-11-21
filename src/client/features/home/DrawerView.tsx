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
  type DrawerView as Drawer,
} from "@/client/shared/api/drawer";
import styles from "./HomeView.module.css";

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

  // The server's figures, read again when the page comes back into view (a sale made on
  // another screen moves the drawer): the preview never runs on stale numbers.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchDrawer()
        .then((d) => {
          if (!alive) return;
          setDrawer(d);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
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
      // The difference the server recorded at the close (its expected amount at that moment).
      const recorded = next.lastCount?.differencePiasters ?? null;
      setDone(
        recorded === null
          ? "اتسجل العدّ ✅ — من دلوقتي هنحسب الدرج"
          : recorded === 0
            ? "اتقفل الدرج، مطابق ✅"
            : `اتقفل الدرج، والفرق ${recorded > 0 ? "+" : ""}${formatMoney(recorded)}`,
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
              <h3 className={styles.sech}>الحركات الكاش من آخر قفل</h3>
              <div className={styles.sumbox} data-testid="drawer-flows">
                <div className={styles.line}>
                  <span>
                    الفلوس وقت آخر قفل{" "}
                    <small className={styles.muted}>
                      ({when(drawer.lastCount.countedAt)})
                    </small>
                  </span>
                  <b data-testid="drawer-base" className={styles.nowrap}>
                    {formatMoney(drawer.lastCount.countedPiasters)}
                  </b>
                </div>
                <div className={styles.line}>
                  <span>داخل كاش</span>
                  <b className={styles.goodText} data-testid="drawer-in">
                    {formatMoney(drawer.inPiasters)}
                  </b>
                </div>
                <div className={styles.line}>
                  <span>خارج كاش</span>
                  <b className={styles.redText} data-testid="drawer-out">
                    {formatMoney(drawer.outPiasters)}
                  </b>
                </div>
              </div>
              {drawer.movements.length === 0 ? (
                <div className={styles.note}>مفيش حركات كاش من آخر قفل</div>
              ) : (
                <div data-testid="drawer-movements">
                  {drawer.movements.map((m) => (
                    <div
                      key={m.id}
                      className={styles.line}
                      data-testid="drawer-movement"
                    >
                      <span>
                        {m.title}{" "}
                        <small className={styles.muted}>{when(m.at)}</small>
                      </span>
                      <b
                        className={
                          m.direction === "in"
                            ? styles.goodText
                            : styles.redText
                        }
                      >
                        {m.direction === "in" ? "+" : "−"}
                        {formatMoney(m.amountPiasters)}
                      </b>
                    </div>
                  ))}
                </div>
              )}
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
                  const d = c.differencePiasters;
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
