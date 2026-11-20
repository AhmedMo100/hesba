"use client";

import { apiGet } from "@/client/shared/api/read-cache";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { parseEgpStrict } from "@/domain/money";
import { useRetryOpId } from "@/client/shared/hooks/useRetryOpId";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "./ExpensesView.module.css";
import { Empty, Icon, ListSkeleton } from "@/client/shared/ui";
import { t, formatMoney, normDigits } from "@/client/shared/i18n";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpensePeriod,
} from "@/schemas/expense";

interface ExpenseItem {
  id: string;
  store_id: string;
  category: string;
  amount_piasters: number;
  note: string | null;
  spent_at: string;
  created_at: string;
  updated_at: string;
  paid_from: string | null;
  machine: { id: string; name: string } | null;
  cancelled_at: string | null;
}

/** The server's Arabic message from an error body `{ error: { message } }`. */
async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string } | string;
  } | null;
  const e = body?.error;
  return (typeof e === "string" ? e : e?.message) || fallback;
}

const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const AR_DAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

function formatExpenseDateCairo(isoDateStr: string): string {
  const date = new Date(isoDateStr);
  if (Number.isNaN(date.getTime())) return "";

  // Get Cairo date representation
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h12",
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1) - 1;
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const rawHour = Number(parts.find((p) => p.type === "hour")?.value ?? 12);
  const minute = String(
    parts.find((p) => p.type === "minute")?.value ?? "00",
  ).padStart(2, "0");
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value ?? "AM";

  // Check today / yesterday in Cairo
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const nowYear = Number(nowParts.find((p) => p.type === "year")?.value ?? 0);
  const nowMonth =
    Number(nowParts.find((p) => p.type === "month")?.value ?? 1) - 1;
  const nowDay = Number(nowParts.find((p) => p.type === "day")?.value ?? 1);

  const cairoMidnight = new Date(year, month, day).getTime();
  const nowMidnight = new Date(nowYear, nowMonth, nowDay).getTime();
  const diffDays = Math.round((nowMidnight - cairoMidnight) / 86400000);

  let datePrefix = "";
  if (diffDays === 0) {
    datePrefix = "النهارده";
  } else if (diffDays === 1) {
    datePrefix = "امبارح";
  } else {
    const dayOfWeek = new Date(year, month, day).getDay();
    datePrefix = `${AR_DAYS[dayOfWeek]} ${day} ${AR_MONTHS[month]}`;
  }

  const ap = dayPeriod.toUpperCase() === "PM" ? "م" : "ص";
  const hourDisplay = rawHour === 0 ? 12 : rawHour;

  return `${datePrefix} · ${hourDisplay}:${minute} ${ap}`;
}

function getTodayCairoDateString(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function ExpensesView() {
  const [selectedCat, setSelectedCat] = useState<ExpenseCategory>("كهرباء");
  const [amountStr, setAmountStr] = useState("");
  const [noteStr, setNoteStr] = useState("");
  // V19 «الدفع إزاي؟»: «cash» (the drawer) or one of the shop's machines / wallets by id.
  const [pay, setPay] = useState<string>("cash");
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState(getTodayCairoDateString());
  const [showExtra, setShowExtra] = useState(false);

  // Only today's expenses here: earlier days live in the reports (التقارير).
  const period: ExpensePeriod = "today";

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [totalPiasters, setTotalPiasters] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadExpenses = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGet(
        `/api/expenses?period=${period}&include_cancelled=1`,
        { force: true },
      );
      if (!res.ok) {
        throw new Error(
          t("pages.expenses.loadError") ||
            "تعذر تحميل المصروفات، برجاء المحاولة مرة أخرى",
        );
      }
      const data = await res.json();
      setExpenses(data.expenses || []);
      setTotalPiasters(data.total_piasters || 0);
      setByCategory(data.by_category || {});
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : t("pages.expenses.loadError") ||
              "تعذر تحميل المصروفات، برجاء المحاولة مرة أخرى",
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    let ignore = false;
    apiGet(`/api/expenses?period=${period}&include_cancelled=1`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            t("pages.expenses.loadError") ||
              "تعذر تحميل المصروفات، برجاء المحاولة مرة أخرى",
          );
        }
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setExpenses(data.expenses || []);
          setTotalPiasters(data.total_piasters || 0);
          setByCategory(data.by_category || {});
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : t("pages.expenses.loadError") ||
                  "تعذر تحميل المصروفات، برجاء المحاولة مرة أخرى",
          );
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [period]);

  const loadMachines = useCallback(() => {
    void fetchStoreMachines().then((list) =>
      setMachines(list.filter((m) => m.status !== "inactive")),
    );
  }, []);
  useEffect(() => {
    loadMachines();
  }, [loadMachines]);
  const payMachine =
    pay === "cash" ? null : (machines.find((m) => m.id === pay) ?? null);

  const expenseOp = useRetryOpId();

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Exact pounds → piasters (no floating point, QA-22); invalid or 0 is refused here.
    const piasters = parseEgpStrict(normDigits(amountStr).trim());
    setFormError(null);
    if (piasters === null || piasters <= 0) {
      setFormError(t("pages.expenses.errorRequiredAmount"));
      return;
    }
    // V19: «رصيد المحفظة مش كافي» before sending; the server checks again under a lock.
    if (payMachine && payMachine.currentBalancePiasters < piasters) {
      setFormError(
        `رصيد ${payMachine.name} مش كافي: فيه ${formatMoney(payMachine.currentBalancePiasters)}`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const payload: {
        category: ExpenseCategory;
        amountPiasters: number;
        note?: string;
        spentAt?: string;
        paidFrom: "cash" | "wallet";
        paidFromMachineId?: string;
      } = {
        category: selectedCat,
        amountPiasters: piasters,
        paidFrom: payMachine ? "wallet" : "cash",
        ...(payMachine ? { paidFromMachineId: payMachine.id } : {}),
      };

      if (noteStr.trim()) {
        payload.note = noteStr.trim();
      }

      if (showExtra && dateStr && dateStr !== getTodayCairoDateString()) {
        payload.spentAt = dateStr;
      }

      // Same expense retried (lost response) → same opId → recorded once (QA-27).
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, opId: expenseOp.opIdFor(payload) }),
      });

      if (!res.ok) {
        throw new Error(await errorMessage(res, "مقدرناش نسجّل المصروف"));
      }

      expenseOp.reset();
      // Reset input fields
      setAmountStr("");
      setNoteStr("");
      setShowExtra(false);

      // Refresh the list and the machines' balances (the server changed them).
      await reloadExpenses();
      loadMachines();
      window.dispatchEvent(new Event("hesba_machines_updated"));
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "مقدرناش نسجّل المصروف",
      );
    } finally {
      setSubmitting(false);
    }
  };

  /** Cancel one of today's expenses: kept on record, its money goes back where it came from. */
  const handleCancel = async (item: ExpenseItem) => {
    const back = item.machine ? `لـ ${item.machine.name}` : "للدرج";
    if (
      !window.confirm(
        `تلغي مصروف ${item.category} بـ ${formatMoney(item.amount_piasters)}؟ الفلوس هترجع ${back}.`,
      )
    ) {
      return;
    }
    setCancelling(item.id);
    try {
      const res = await fetch(`/api/expenses/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error(await errorMessage(res, "مقدرناش نلغي المصروف"));
      }
      await reloadExpenses();
      loadMachines();
      window.dispatchEvent(new Event("hesba_machines_updated"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "مقدرناش نلغي المصروف");
    } finally {
      setCancelling(null);
    }
  };

  const periodTitle = t(`pages.expenses.periods.${period}`);

  const activeCategoriesCount = useMemo(() => {
    return Object.keys(byCategory).length;
  }, [byCategory]);

  return (
    <div className={viewStyles.view} data-testid="page-expenses">
      <div className={styles.container}>
        {/* V19: what was it for, how much, a note, save */}
        <h2 className={styles.askTitle}>{t("pages.expenses.askTitle")}</h2>
        <form onSubmit={handleRegister} className={styles.v19Form}>
          <div className={styles.chips} role="radiogroup">
            {EXPENSE_CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat}
                role="radio"
                aria-checked={selectedCat === cat}
                className={`${styles.chip} ${selectedCat === cat ? styles.chipOn : ""}`}
                onClick={() => setSelectedCat(cat)}
              >
                {t(`pages.expenses.categories.${cat}`)}
              </button>
            ))}
          </div>

          <label className={styles.lbl} htmlFor="expense-amount">
            {t("pages.expenses.amount")}
          </label>
          <input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className={styles.input}
            autoComplete="off"
            data-testid="expense-amount"
          />
          <div className={styles.chips}>
            {[50, 100, 250].map((v) => (
              <button
                type="button"
                key={v}
                className={styles.chip}
                onClick={() => setAmountStr(String(v))}
              >
                {v} ج
              </button>
            ))}
          </div>

          <span className={styles.lbl}>الدفع إزاي؟</span>
          <div className={styles.chips} data-testid="expense-pay">
            <button
              type="button"
              className={`${styles.chip} ${pay === "cash" ? styles.chipOn : ""}`}
              onClick={() => setPay("cash")}
              data-testid="expense-from-cash"
            >
              💵 كاش
            </button>
            {machines.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`${styles.chip} ${pay === m.id ? styles.chipOn : ""}`}
                onClick={() => setPay(m.id)}
                data-testid="expense-from-machine"
              >
                💳 {m.name}
              </button>
            ))}
          </div>
          {payMachine && (
            <p className={styles.payNote} data-testid="expense-machine-balance">
              رصيد {payMachine.name} دلوقتي{" "}
              {formatMoney(payMachine.currentBalancePiasters)}
            </p>
          )}

          <label className={styles.lbl} htmlFor="expense-note">
            {t("pages.expenses.noteLabel")}
          </label>
          <input
            id="expense-note"
            type="text"
            dir="auto"
            value={noteStr}
            placeholder={t("pages.expenses.notePlaceholder")}
            onChange={(e) => setNoteStr(e.target.value)}
            className={styles.input}
          />

          <button
            type="button"
            className={styles.noteToggle}
            onClick={() => setShowExtra((v) => !v)}
          >
            {t("pages.expenses.otherDay")}
          </button>
          {showExtra && (
            <input
              type="date"
              value={dateStr}
              max={getTodayCairoDateString()}
              onChange={(e) =>
                setDateStr(e.target.value || getTodayCairoDateString())
              }
              className={styles.input}
              aria-label={t("pages.expenses.dayLabel")}
            />
          )}

          {formError && (
            <p
              className={styles.formError}
              role="alert"
              data-testid="expense-error"
            >
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className={styles.saveBtn}
            data-testid="expense-save"
          >
            {submitting
              ? t("pages.expenses.saving") || "جاري التسجيل..."
              : t("pages.expenses.saveExpense")}
          </button>
        </form>

        {/* Total Summary Banner */}
        <div className={styles.totalBanner}>
          <span className={styles.totalLabel}>
            {t("pages.expenses.totalPrefix")}
            {periodTitle}
          </span>
          <span className={styles.totalAmount}>
            {formatMoney(totalPiasters)}
          </span>
        </div>

        {/* Category Breakdown Chips (if more than one category has expenses) */}
        {activeCategoriesCount > 1 && (
          <div className={styles.breakdownBar}>
            {Object.entries(byCategory).map(([cat, amt]) => (
              <span key={cat} className={styles.breakdownChip}>
                {t(`pages.expenses.categories.${cat}`) || cat}:{" "}
                {formatMoney(amt)}
              </span>
            ))}
          </div>
        )}

        {/* Expense List, Empty State, Loading, or Error State */}
        {error ? (
          <div className={styles.errorCard} role="alert">
            <Icon n="alert" s={24} />
            <p className={styles.errorTitle}>{error}</p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={() => reloadExpenses()}
            >
              <Icon n="refresh" s={16} />
              {t("pages.expenses.retry") || "إعادة المحاولة"}
            </button>
          </div>
        ) : loading && expenses.length === 0 ? (
          <ListSkeleton rows={3} label="بيحمّل المصاريف…" />
        ) : expenses.length === 0 ? (
          <div className={styles.emptyCard}>
            <Empty icon="wallet" title={t("pages.expenses.empty")} />
          </div>
        ) : (
          <div className={styles.listCard}>
            {expenses.map((item) => (
              <div
                key={item.id}
                className={`${styles.expenseRow} ${item.cancelled_at ? styles.cancelledRow : ""}`}
                data-testid="expense-row"
              >
                <div className={styles.itemInfo}>
                  <b className={styles.itemCategory}>
                    {t(`pages.expenses.categories.${item.category}`) ||
                      item.category}
                  </b>
                  <span className={styles.itemMeta}>
                    {formatExpenseDateCairo(item.spent_at)}
                    {" · "}
                    {item.machine
                      ? `💳 ${item.machine.name}`
                      : item.paid_from === "cash"
                        ? "💵 كاش"
                        : ""}
                    {item.note ? ` · ${item.note}` : ""}
                  </span>
                </div>
                <div className={styles.itemActions}>
                  <b className={styles.itemAmount}>
                    {formatMoney(item.amount_piasters)}
                  </b>
                  {item.cancelled_at ? (
                    <span
                      className={styles.cancelledTag}
                      data-testid="expense-cancelled"
                    >
                      اتلغى
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={styles.undoBtn}
                      disabled={cancelling === item.id}
                      onClick={() => handleCancel(item)}
                      data-testid="expense-cancel"
                    >
                      ↩️ رجّع
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className={styles.historyNote} data-testid="expenses-history-note">
          مصروفات الأيام اللي فاتت في التقارير 📊
        </p>
      </div>
    </div>
  );
}

export default ExpensesView;
