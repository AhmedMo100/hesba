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
  // V19 «الدفع إزاي؟»: from the drawer or a wallet (ADR-0031).
  const [paidFrom, setPaidFrom] = useState<"cash" | "wallet">("cash");
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
      const res = await apiGet(`/api/expenses?period=${period}`);
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
    apiGet(`/api/expenses?period=${period}`)
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

  const expenseOp = useRetryOpId();

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Exact pounds → piasters (no floating point, QA-22); invalid or 0 is refused here.
    const piasters = parseEgpStrict(normDigits(amountStr).trim());
    if (piasters === null || piasters <= 0) {
      alert(t("pages.expenses.errorRequiredAmount"));
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
      } = {
        category: selectedCat,
        amountPiasters: piasters,
        paidFrom,
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
        const errJson = await res.json();
        throw new Error(errJson.error || "فشل تسجيل المصروف");
      }

      expenseOp.reset();
      // Reset input fields
      setAmountStr("");
      setNoteStr("");
      setShowExtra(false);

      // Refresh list
      await reloadExpenses();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "حدث خطأ أثناء التسجيل");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm(t("pages.expenses.deleteConfirm"));
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("فشل حذف المصروف");
      }

      // Optimistically update list
      setExpenses((prev) => prev.filter((item) => item.id !== id));
      await reloadExpenses();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "تعذر حذف المصروف");
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
          <div className={styles.chips}>
            {(
              [
                ["cash", "💵 كاش من الدرج"],
                ["wallet", "📱 محفظة / ماكينة"],
              ] as const
            ).map(([k, label]) => (
              <button
                type="button"
                key={k}
                className={`${styles.chip} ${paidFrom === k ? styles.chipOn : ""}`}
                onClick={() => setPaidFrom(k)}
                data-testid={`expense-from-${k}`}
              >
                {label}
              </button>
            ))}
          </div>

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
              <div key={item.id} className={styles.expenseRow}>
                <div className={styles.itemInfo}>
                  <b className={styles.itemCategory}>
                    {t(`pages.expenses.categories.${item.category}`) ||
                      item.category}
                  </b>
                  <span className={styles.itemMeta}>
                    {formatExpenseDateCairo(item.spent_at)}
                    {item.note ? ` · ${item.note}` : ""}
                  </span>
                </div>
                <div className={styles.itemActions}>
                  <b className={styles.itemAmount}>
                    {formatMoney(item.amount_piasters)}
                  </b>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    aria-label={t("pages.expenses.deleteAriaLabel")}
                    onClick={() => handleDelete(item.id)}
                  >
                    <Icon n="trash" s={17} />
                  </button>
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
