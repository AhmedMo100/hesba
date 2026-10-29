"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import viewStyles from "./ViewLayout.module.css";
import styles from "./ExpensesView.module.css";
import { Empty, Icon } from "../../shared/ui";
import { t, formatMoney, normDigits } from "../../shared/i18n";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  EXPENSE_PERIODS,
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
  const [dateStr, setDateStr] = useState(getTodayCairoDateString());
  const [showExtra, setShowExtra] = useState(false);

  const [period, setPeriod] = useState<ExpensePeriod>("today");
  const [customFrom, setCustomFrom] = useState(getTodayCairoDateString());
  const [customTo, setCustomTo] = useState(getTodayCairoDateString());

  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [totalPiasters, setTotalPiasters] = useState(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadExpenses = useCallback(async () => {
    try {
      let url = `/api/expenses?period=${period}`;
      if (period === "custom") {
        url += `&from=${customFrom}&to=${customTo}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("فشل في تحميل المصروفات");
      }
      const data = await res.json();
      setExpenses(data.expenses || []);
      setTotalPiasters(data.total_piasters || 0);
      setByCategory(data.by_category || {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    let ignore = false;
    let url = `/api/expenses?period=${period}`;
    if (period === "custom") {
      url += `&from=${customFrom}&to=${customTo}`;
    }

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("فشل في تحميل المصروفات");
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setExpenses(data.expenses || []);
          setTotalPiasters(data.total_piasters || 0);
          setByCategory(data.by_category || {});
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [period, customFrom, customTo]);

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanAmt = normDigits(amountStr).replace(/[^\d.]/g, "");
    const egp = parseFloat(cleanAmt);
    if (!Number.isFinite(egp) || egp <= 0) {
      alert(t("pages.expenses.errorRequiredAmount"));
      return;
    }

    const piasters = Math.round(egp * 100);
    setSubmitting(true);
    try {
      const payload: {
        category: ExpenseCategory;
        amountPiasters: number;
        note?: string;
        spentAt?: string;
      } = {
        category: selectedCat,
        amountPiasters: piasters,
      };

      if (noteStr.trim()) {
        payload.note = noteStr.trim();
      }

      if (showExtra && dateStr && dateStr !== getTodayCairoDateString()) {
        payload.spentAt = dateStr;
      }

      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "فشل تسجيل المصروف");
      }

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

  const periodTitle = useMemo(() => {
    return t(`pages.expenses.periods.${period}`);
  }, [period]);

  const activeCategoriesCount = useMemo(() => {
    return Object.keys(byCategory).length;
  }, [byCategory]);

  return (
    <div className={viewStyles.view} data-testid="page-expenses">
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.head}>
          <h1 className={styles.title}>{t("pages.expenses.title")}</h1>
          <p className={styles.sub}>{t("pages.expenses.sub")}</p>
        </div>

        {/* Input Card */}
        <div className={styles.formCard}>
          {/* Category Chips */}
          <div className={styles.catGrid} role="radiogroup">
            {EXPENSE_CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat}
                role="radio"
                aria-checked={selectedCat === cat}
                className={`${styles.catChip} ${selectedCat === cat ? styles.active : ""}`}
                onClick={() => setSelectedCat(cat)}
              >
                {t(`pages.expenses.categories.${cat}`)}
              </button>
            ))}
          </div>

          {/* Amount Row Form */}
          <form onSubmit={handleRegister} className={styles.amountFieldGroup}>
            <label className={styles.amountLabel}>
              {t("pages.expenses.amount")}
            </label>
            <div className={styles.amountRow}>
              <div className={styles.inputWrapper}>
                <span className={styles.currencyBadge}>
                  {t("pages.expenses.currency")}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={t("pages.expenses.amountPlaceholder")}
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  className={styles.amountInput}
                  autoComplete="off"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className={styles.registerBtn}
              >
                <Icon n="plus" s={18} />
                {t("pages.expenses.addExpense")}
              </button>
            </div>

            {/* Expandable Link for Note & Date */}
            <button
              type="button"
              className={styles.noteToggle}
              onClick={() => setShowExtra((v) => !v)}
            >
              {showExtra
                ? t("pages.expenses.noteLinkClose")
                : t("pages.expenses.noteLinkOpen")}
            </button>

            {/* Expanded Fields */}
            {showExtra && (
              <div className={styles.extraFields}>
                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>
                    {t("pages.expenses.noteLabel")}
                  </label>
                  <input
                    type="text"
                    value={noteStr}
                    placeholder={t("pages.expenses.notePlaceholder")}
                    onChange={(e) => setNoteStr(e.target.value)}
                    className={styles.textInput}
                  />
                </div>
                <div className={styles.fieldItem}>
                  <label className={styles.fieldLabel}>
                    {t("pages.expenses.dayLabel")}
                  </label>
                  <input
                    type="date"
                    value={dateStr}
                    max={getTodayCairoDateString()}
                    onChange={(e) =>
                      setDateStr(e.target.value || getTodayCairoDateString())
                    }
                    className={styles.textInput}
                  />
                </div>
              </div>
            )}
          </form>
        </div>

        {/* Period Filter Chips */}
        <div className={styles.periodRow} role="tablist">
          {EXPENSE_PERIODS.map((pKey) => (
            <button
              type="button"
              key={pKey}
              role="tab"
              aria-selected={period === pKey}
              className={`${styles.periodChip} ${period === pKey ? styles.active : ""}`}
              onClick={() => setPeriod(pKey)}
            >
              {t(`pages.expenses.periods.${pKey}`)}
            </button>
          ))}
        </div>

        {/* Custom Date Pickers */}
        {period === "custom" && (
          <div className={styles.customRange}>
            <div className={styles.customDateItem}>
              <span className={styles.customDateLabel}>
                {t("pages.expenses.customFrom")}
              </span>
              <input
                type="date"
                value={customFrom}
                max={getTodayCairoDateString()}
                onChange={(e) =>
                  setCustomFrom(e.target.value || getTodayCairoDateString())
                }
                className={styles.customDateInput}
              />
            </div>
            <div className={styles.customDateItem}>
              <span className={styles.customDateLabel}>
                {t("pages.expenses.customTo")}
              </span>
              <input
                type="date"
                value={customTo}
                max={getTodayCairoDateString()}
                onChange={(e) =>
                  setCustomTo(e.target.value || getTodayCairoDateString())
                }
                className={styles.customDateInput}
              />
            </div>
          </div>
        )}

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

        {/* Error message */}
        {error && <div className={styles.errorMessage}>{error}</div>}

        {/* Expense List or Empty State */}
        {loading && expenses.length === 0 ? (
          <div className={styles.emptyCard}>
            <p>جاري التحميل...</p>
          </div>
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
      </div>
    </div>
  );
}

export default ExpensesView;
