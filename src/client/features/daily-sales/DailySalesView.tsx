"use client";

/**
 * @file DailySalesView.tsx
 * @description «مبيعات اليوم» for إدارة المحل (ADR-0033): the day's sales as one total, split by how
 * it was paid — cash (counted in the drawer) and each machine / wallet of the shop (its balance
 * goes up). It records money only: it never claims which products were sold, so no stock moves
 * (a stock difference is found at the stocktake). Today's entries can be cancelled; they stay on
 * record. Same look as «صرفت فلوس» (V19).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, normDigits } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { toCairoDateString } from "@/domain/time";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import type { DailySalesEntryView } from "@/schemas/daily-sales";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";

interface DayList {
  entries: DailySalesEntryView[];
  totalPiasters: number;
  cashPiasters: number;
  walletPiasters: number;
}

const toPiasters = (v: string) => {
  const t = normDigits(v).trim();
  if (!t) return 0;
  return parseEgpStrict(t);
};

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

export function DailySalesView() {
  const today = useMemo(() => toCairoDateString(new Date()), []);
  const [day, setDay] = useState(today);
  const [cash, setCash] = useState("");
  const [parts, setParts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [list, setList] = useState<DayList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opId, setOpId] = useState(() => crypto.randomUUID());

  const load = useCallback(() => {
    fetch(`/api/daily-sales?from=${day}&to=${day}`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(await errorText(r, "مقدرناش نجيب مبيعات اليوم"));
        return (await r.json()) as DayList;
      })
      .then((d) => {
        setList(d);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "مفيش نت"),
      );
  }, [day]);
  useEffect(load, [load]);
  useEffect(() => {
    void fetchStoreMachines().then((l) =>
      setMachines(l.filter((m) => m.status !== "inactive")),
    );
  }, []);

  const cashP = toPiasters(cash);
  const partP = machines.map((m) => ({ m, p: toPiasters(parts[m.id] ?? "") }));
  const invalid = cashP === null || partP.some((x) => x.p === null);
  const total = (cashP ?? 0) + partP.reduce((s, x) => s + (x.p ?? 0), 0);

  const save = async () => {
    setFormError(null);
    if (invalid) return setFormError("اكتب المبالغ بالجنيه صح");
    if (!(total > 0)) return setFormError("اكتب مبيعات اليوم");
    setBusy(true);
    try {
      const res = await fetch("/api/daily-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opId,
          businessDay: day,
          cashPiasters: cashP ?? 0,
          parts: partP
            .filter((x) => (x.p ?? 0) > 0)
            .map((x) => ({ machineId: x.m.id, amountPiasters: x.p })),
          note: note.trim() || null,
        }),
      });
      if (!res.ok)
        throw new Error(await errorText(res, "مقدرناش نسجّل مبيعات اليوم"));
      setOpId(crypto.randomUUID());
      setCash("");
      setParts({});
      setNote("");
      load();
      void fetchStoreMachines().then((l) =>
        setMachines(l.filter((m) => m.status !== "inactive")),
      );
    } catch (e: unknown) {
      setFormError(
        e instanceof Error ? e.message : "مقدرناش نسجّل مبيعات اليوم",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (e: DailySalesEntryView) => {
    if (
      !window.confirm(
        `تلغي تسجيل ${formatMoney(e.totalPiasters)}؟ الكاش هيطلع من حساب الدرج، وفلوس المحافظ هترجع منها.`,
      )
    )
      return;
    const res = await fetch(`/api/daily-sales/${e.id}`, { method: "DELETE" });
    if (!res.ok) setError(await errorText(res, "مقدرناش نلغي"));
    load();
  };

  return (
    <div className={viewStyles.view} data-testid="page-daily-sales">
      <div className={styles.container}>
        <h2 className={styles.askTitle}>بعت بكام النهارده؟</h2>
        <p
          className={styles.historyNote}
          style={{ textAlign: "start", margin: "0 0 8px" }}
        >
          في «إدارة المحل» بتكتب إجمالي اللي بعته، مش كل بيعة. الكاش بيدخل حساب
          الدرج، وفلوس المحافظ بتزوّد رصيدها.
        </p>
        <div className={styles.v19Form}>
          <label className={styles.lbl} htmlFor="ds-day">
            اليوم
          </label>
          <input
            id="ds-day"
            type="date"
            className={styles.input}
            value={day}
            max={today}
            onChange={(ev) => setDay(ev.target.value || today)}
            data-testid="daily-day"
          />
          <label className={styles.lbl} htmlFor="ds-cash">
            💵 كاش
          </label>
          <input
            id="ds-cash"
            className={styles.input}
            inputMode="decimal"
            placeholder="0"
            value={cash}
            onChange={(ev) => setCash(ev.target.value)}
            data-testid="daily-cash"
          />
          {machines.map((m) => (
            <React.Fragment key={m.id}>
              <label className={styles.lbl} htmlFor={`ds-${m.id}`}>
                💳 {m.name}
              </label>
              <input
                id={`ds-${m.id}`}
                className={styles.input}
                inputMode="decimal"
                placeholder="0"
                value={parts[m.id] ?? ""}
                onChange={(ev) =>
                  setParts((p) => ({ ...p, [m.id]: ev.target.value }))
                }
                data-testid="daily-machine"
              />
            </React.Fragment>
          ))}
          <label className={styles.lbl} htmlFor="ds-note">
            ملاحظة (اختياري)
          </label>
          <input
            id="ds-note"
            className={styles.input}
            dir="auto"
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
          />
          <div className={styles.totalBanner}>
            <span className={styles.totalLabel}>الإجمالي</span>
            <span className={styles.totalAmount} data-testid="daily-total">
              {invalid ? "—" : formatMoney(total)}
            </span>
          </div>
          {formError && (
            <p
              className={styles.formError}
              role="alert"
              data-testid="daily-error"
            >
              {formError}
            </p>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            disabled={busy}
            onClick={() => void save()}
            data-testid="daily-save"
          >
            {busy ? "بيتسجّل…" : "سجّل مبيعات اليوم"}
          </button>
        </div>

        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        {list && list.entries.length > 0 && (
          <>
            <div className={styles.totalBanner}>
              <span className={styles.totalLabel}>
                اتسجل لليوم ده · كاش {formatMoney(list.cashPiasters)} · محافظ{" "}
                {formatMoney(list.walletPiasters)}
              </span>
              <span
                className={styles.totalAmount}
                data-testid="daily-day-total"
              >
                {formatMoney(list.totalPiasters)}
              </span>
            </div>
            <div className={styles.listCard}>
              {list.entries.map((e) => (
                <div
                  key={e.id}
                  className={`${styles.expenseRow} ${e.cancelledAt ? styles.cancelledRow : ""}`}
                  data-testid="daily-row"
                >
                  <div className={styles.itemInfo}>
                    <b className={styles.itemCategory}>
                      {formatMoney(e.totalPiasters)}
                    </b>
                    <span className={styles.itemMeta}>
                      💵 {formatMoney(e.cashPiasters)}
                      {e.parts.map(
                        (p) =>
                          ` · 💳 ${p.machineName} ${formatMoney(p.amountPiasters)}`,
                      )}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                  </div>
                  <div className={styles.itemActions}>
                    {e.cancelledAt ? (
                      <span className={styles.cancelledTag}>اتلغى</span>
                    ) : toCairoDateString(new Date(e.createdAt)) === today ? (
                      <button
                        type="button"
                        className={styles.undoBtn}
                        onClick={() => void cancel(e)}
                        data-testid="daily-cancel"
                      >
                        ↩️ رجّع
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <p className={styles.historyNote}>
          الإجمالي مش بيخصم من المخزون: أي فرق في البضاعة بيبان في الجرد كفرق
          جرد.
        </p>
      </div>
    </div>
  );
}

export default DailySalesView;
