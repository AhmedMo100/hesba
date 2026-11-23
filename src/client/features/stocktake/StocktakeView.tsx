"use client";

/**
 * @file StocktakeView.tsx
 * @description «الجرد الفعلي»: count what is really on the shelves and settle the differences.
 * The owner types what he found; Hesba shows the difference and its value, and for every
 * shortage asks WHY (sold and not recorded, damaged, lost / stolen, or don't know). A shortage
 * is never turned into sales by itself. Nothing changes in stock until «أكّد الجرد»; a cancelled
 * count changes nothing. Moving goods from the store room to the shelf is not counted here.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/client/shared/i18n";
import { apiGet } from "@/client/shared/api/read-cache";
import {
  formatBaseQty,
  qtyUnitWord,
  toBaseQty,
  variantOptions,
  type StoreVariantOption,
  failureMessage,
} from "@/client/shared/quantity";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";

type Reason = "unrecorded_sale" | "damaged" | "lost" | "unknown" | "surplus";
const SHORTAGE_REASONS: Array<[Reason, string]> = [
  ["unknown", "مش عارف السبب"],
  ["unrecorded_sale", "اتباع ومتسجلش"],
  ["damaged", "تالف"],
  ["lost", "ضايع / مسروق"],
];

interface Line {
  variantId: string;
  productName: string;
  category: string;
  unit: string;
  expectedBase: number;
  countedBase: number | null;
  differenceBase: number | null;
  reason: Reason | null;
  differenceCostPiasters: number | null;
  differenceSellPiasters: number | null;
}
interface Count {
  id: string;
  scope: string;
  category: string | null;
  status: "open" | "confirmed" | "abandoned";
  startedAt: string;
  confirmedAt: string | null;
  totals: {
    lines: number;
    counted: number;
    matched: number;
    discrepancies: number;
    shortageCostPiasters: number;
    surplusCostPiasters: number;
    damagedBase: number;
    lostBase: number;
    unrecordedSaleBase: number;
    unrecordedSaleSellPiasters: number;
    unknownBase: number;
    unknownCostLines: number;
  };
  lines: Line[];
}
interface Overview {
  lastConfirmedAt: string | null;
  daysSinceLastCount: number | null;
  open: { id: string } | null;
  history: Array<{
    id: string;
    scope: string;
    category: string | null;
    status: string;
    startedAt: string;
    confirmedAt: string | null;
    lines: number;
    counted: number;
    discrepancies: number;
    damagedBase: number;
    shortageCostPiasters: number;
    surplusCostPiasters: number;
  }>;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "long",
  });
const STATUS: Record<string, string> = {
  open: "شغال",
  confirmed: "اتأكد",
  abandoned: "اتلغى",
};

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

export function StocktakeView() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [count, setCount] = useState<Count | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<StoreVariantOption[]>([]);
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  // Typed quantities and reasons not saved yet, per variant.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, Reason>>({});
  const [review, setReview] = useState(false);

  const loadOverview = useCallback(() => {
    fetch("/api/inventory-counts", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorText(r, "مقدرناش نجيب الجرد"));
        return (await r.json()) as Overview;
      })
      .then(setOverview)
      .catch((e: unknown) => setError(failureMessage(e, "مفيش نت")));
  }, []);
  const openCount = useCallback(async (id: string) => {
    const r = await fetch(`/api/inventory-counts/${id}`, {
      credentials: "same-origin",
    });
    if (!r.ok) return setError(await errorText(r, "مقدرناش نفتح الجرد"));
    setCount(((await r.json()) as { count: Count }).count);
    setTyped({});
    setReasons({});
    setReview(false);
  }, []);
  useEffect(loadOverview, [loadOverview]);
  useEffect(() => {
    apiGet("/api/products?scope=store")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVariants(variantOptions(d)))
      .catch(() => {});
  }, []);
  const categories = useMemo(
    () => [...new Set(variants.map((v) => v.category).filter(Boolean))].sort(),
    [variants],
  );

  const start = async (scope: "full" | "category" | "selected") => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/inventory-counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opId: crypto.randomUUID(),
          scope,
          ...(scope === "category" ? { category } : {}),
          ...(scope === "selected" ? { variantIds: picked } : {}),
        }),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نبدأ الجرد"));
      const c = ((await res.json()) as { count: Count }).count;
      setCount(c);
      setPicked([]);
      loadOverview();
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نبدأ الجرد"));
    } finally {
      setBusy(false);
    }
  };

  const pending = count
    ? count.lines.filter(
        (l) =>
          typed[l.variantId] !== undefined ||
          reasons[l.variantId] !== undefined,
      )
    : [];
  const saveCounts = async (): Promise<Count | null> => {
    if (!count || pending.length === 0) return count;
    const lines = [];
    for (const l of pending) {
      const t = typed[l.variantId];
      const base =
        t === undefined
          ? l.countedBase
          : t.trim() === ""
            ? null
            : toBaseQty(l.unit, t);
      if (t !== undefined && t.trim() !== "" && base === null) {
        setError(`«${l.productName}»: اكتب الكمية صح (${qtyUnitWord(l.unit)})`);
        return null;
      }
      lines.push({
        variantId: l.variantId,
        countedBase: base,
        reason: reasons[l.variantId] ?? l.reason ?? null,
      });
    }
    const res = await fetch(`/api/inventory-counts/${count.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    if (!res.ok) {
      setError(await errorText(res, "مقدرناش نحفظ العدّ"));
      return null;
    }
    const c = ((await res.json()) as { count: Count }).count;
    setCount(c);
    setTyped({});
    setReasons({});
    return c;
  };

  const confirm = async () => {
    if (!count) return;
    if (
      !window.confirm(
        "تأكد الجرد؟ المخزون هيتعدّل بالفروق دي، ومش هينفع تعدّل الجرد بعد كده.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory-counts/${count.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opId: crypto.randomUUID() }),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نأكد الجرد"));
      setCount(((await res.json()) as { count: Count }).count);
      setReview(false);
      loadOverview();
      window.dispatchEvent(new Event("hesba_stock_updated"));
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نأكد الجرد"));
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    if (!count) return;
    if (!window.confirm("تلغي الجرد ده؟ مفيش أي حاجة هتتغير في المخزون."))
      return;
    const res = await fetch(`/api/inventory-counts/${count.id}/abandon`, {
      method: "POST",
    });
    if (!res.ok) return setError(await errorText(res, "مقدرناش نلغي"));
    setCount(null);
    loadOverview();
  };

  // ── A count is open (or being looked at) ──
  if (count) {
    const t = count.totals;
    const shown = count.lines.filter(
      (l) => !filter.trim() || l.productName.includes(filter.trim()),
    );
    const readOnly = count.status !== "open";
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.container}>
          <button
            type="button"
            className={styles.undoBtn}
            onClick={() => {
              setCount(null);
              loadOverview();
            }}
          >
            → رجوع لصفحة الجرد
          </button>
          <h2 className={styles.askTitle}>
            {count.scope === "full"
              ? "جرد المحل كله"
              : count.scope === "category"
                ? `جرد ${count.category}`
                : "جرد أصناف معينة"}
            {" · "}
            {STATUS[count.status]}
          </h2>
          <div className={styles.totalBanner} data-testid="stocktake-totals">
            <span className={styles.totalLabel}>
              اتعدّ {t.counted} من {t.lines} · مظبوط {t.matched} · فيه فرق{" "}
              {t.discrepancies}
            </span>
            <span className={styles.totalAmount}>
              {t.shortageCostPiasters > 0
                ? `−${formatMoney(t.shortageCostPiasters)}`
                : ""}
            </span>
          </div>
          {error && (
            <p
              className={styles.formError}
              role="alert"
              data-testid="stocktake-error"
            >
              {error}
            </p>
          )}

          {review && !readOnly ? (
            <div className={styles.v19Form} data-testid="stocktake-review">
              <h3 className={styles.askTitle} style={{ fontSize: 18 }}>
                راجع قبل ما تأكد
              </h3>
              <p
                className={styles.historyNote}
                style={{ textAlign: "start", margin: 0 }}
              >
                • ناقص بقيمة {formatMoney(t.shortageCostPiasters)} (بسعر الشراء)
              </p>
              {t.unrecordedSaleBase > 0 && (
                <p
                  className={styles.historyNote}
                  style={{ textAlign: "start", margin: 0 }}
                >
                  • قلت إنه اتباع ومتسجلش: هيتحسب مبيعات بـ{" "}
                  {formatMoney(t.unrecordedSaleSellPiasters)} (من غير فلوس جديدة
                  في الدرج)
                </p>
              )}
              {(t.damagedBase > 0 || t.lostBase > 0) && (
                <p
                  className={styles.historyNote}
                  style={{ textAlign: "start", margin: 0 }}
                >
                  • تالف وضايع: هيتحسب خسارة مرة واحدة
                </p>
              )}
              {t.unknownBase > 0 && (
                <p
                  className={styles.historyNote}
                  style={{ textAlign: "start", margin: 0 }}
                >
                  • فرق مش معروف سببه: هيتحسب خسارة، مش مبيعات
                </p>
              )}
              {t.surplusCostPiasters > 0 && (
                <p
                  className={styles.historyNote}
                  style={{ textAlign: "start", margin: 0 }}
                >
                  • زيادة بقيمة {formatMoney(t.surplusCostPiasters)}: هتتضاف
                  للمخزون
                </p>
              )}
              {t.unknownCostLines > 0 && (
                <p
                  className={styles.historyNote}
                  style={{ textAlign: "start", margin: 0 }}
                >
                  • {t.unknownCostLines} صنف من غير سعر شراء: قيمته مش محسوبة
                </p>
              )}
              <button
                type="button"
                className={styles.saveBtn}
                disabled={busy}
                onClick={() => void confirm()}
                data-testid="stocktake-confirm"
              >
                {busy ? "بيتأكد…" : "✅ أكّد الجرد"}
              </button>
              <button
                type="button"
                className={styles.undoBtn}
                onClick={() => setReview(false)}
              >
                رجوع للعدّ
              </button>
            </div>
          ) : (
            <>
              <input
                className={styles.input}
                dir="auto"
                placeholder="دوّر على صنف…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className={styles.listCard} data-testid="stocktake-lines">
                {shown.map((l) => {
                  const typedText = typed[l.variantId];
                  const counted =
                    typedText !== undefined
                      ? toBaseQty(l.unit, typedText)
                      : l.countedBase;
                  const diff =
                    counted === null ? null : counted - l.expectedBase;
                  const reason = reasons[l.variantId] ?? l.reason ?? "unknown";
                  return (
                    <div
                      key={l.variantId}
                      className={styles.expenseRow}
                      data-testid="stocktake-line"
                    >
                      <div className={styles.itemInfo}>
                        <b className={styles.itemCategory}>{l.productName}</b>
                        <span className={styles.itemMeta}>
                          المتسجل: {formatBaseQty(l.unit, l.expectedBase)}
                          {diff !== null && diff !== 0 && (
                            <>
                              {" · "}
                              <b
                                style={{
                                  color:
                                    diff < 0
                                      ? "var(--danger, #b42318)"
                                      : "var(--good, #067647)",
                                }}
                              >
                                {diff < 0 ? "ناقص " : "زيادة "}
                                {formatBaseQty(l.unit, Math.abs(diff))}
                              </b>
                            </>
                          )}
                          {diff === 0 && " · ✓ مظبوط"}
                        </span>
                        {!readOnly && diff !== null && diff < 0 && (
                          <select
                            className={styles.input}
                            value={reason}
                            onChange={(e) =>
                              setReasons((r) => ({
                                ...r,
                                [l.variantId]: e.target.value as Reason,
                              }))
                            }
                            aria-label={`سبب النقص في ${l.productName}`}
                            data-testid="stocktake-reason"
                          >
                            {SHORTAGE_REASONS.map(([k, label]) => (
                              <option key={k} value={k}>
                                {label}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      <div className={styles.itemActions}>
                        {readOnly ? (
                          <b>
                            {l.countedBase === null
                              ? "—"
                              : formatBaseQty(l.unit, l.countedBase)}
                          </b>
                        ) : (
                          <input
                            className={styles.input}
                            style={{ maxWidth: 110 }}
                            inputMode="decimal"
                            placeholder={qtyUnitWord(l.unit)}
                            value={
                              typedText ??
                              (l.countedBase === null
                                ? ""
                                : l.unit === "kg"
                                  ? String(l.countedBase / 1000)
                                  : String(l.countedBase))
                            }
                            onChange={(e) =>
                              setTyped((x) => ({
                                ...x,
                                [l.variantId]: e.target.value,
                              }))
                            }
                            aria-label={`العدد الفعلي لـ ${l.productName}`}
                            data-testid="stocktake-count"
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {!readOnly && (
                <div className={styles.v19Form}>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    disabled={busy || pending.length === 0}
                    onClick={() => void saveCounts()}
                    data-testid="stocktake-save"
                  >
                    💾 احفظ العدّ{" "}
                    {pending.length > 0 ? `(${pending.length})` : ""}
                  </button>
                  <button
                    type="button"
                    className={styles.saveBtn}
                    disabled={busy}
                    onClick={async () => {
                      const c = await saveCounts();
                      if (c && c.totals.counted > 0) setReview(true);
                      else if (c) setError("اعدّ صنف واحد على الأقل");
                    }}
                    data-testid="stocktake-review-open"
                  >
                    راجع وأكّد ←
                  </button>
                  <button
                    type="button"
                    className={styles.undoBtn}
                    onClick={() => void abandon()}
                    data-testid="stocktake-abandon"
                  >
                    ✕ الغي الجرد ده
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── The stocktaking page ──
  const matches = search.trim()
    ? variants
        .filter(
          (v) =>
            v.name.includes(search.trim()) && !picked.includes(v.variantId),
        )
        .slice(0, 8)
    : [];
  return (
    <div className={viewStyles.view} data-testid="page-stocktake">
      <div className={styles.container}>
        <h2 className={styles.askTitle}>الجرد الفعلي</h2>
        <p
          className={styles.historyNote}
          style={{ textAlign: "start", margin: "0 0 8px" }}
        >
          اعدّ اللي على الرفوف فعلاً، وحِسبة تقولك الفرق وقيمته. أي نقص بتختار
          سببه إنت — عمره ما بيتحسب مبيعات لوحده. نقل البضاعة من المخزن للرف مش
          محتاج تسجيل.
        </p>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        {overview && (
          <div className={styles.totalBanner} data-testid="stocktake-last">
            <span className={styles.totalLabel}>آخر جرد</span>
            <span className={styles.totalAmount}>
              {overview.lastConfirmedAt
                ? `${day(overview.lastConfirmedAt)} (من ${overview.daysSinceLastCount} يوم)`
                : "لسه ما اتعملش"}
            </span>
          </div>
        )}
        {overview?.open ? (
          <button
            type="button"
            className={styles.saveBtn}
            onClick={() => void openCount(overview.open!.id)}
            data-testid="stocktake-continue"
          >
            كمّل الجرد المفتوح ←
          </button>
        ) : (
          <div className={styles.v19Form}>
            <b>اعمل جرد جديد</b>
            <button
              type="button"
              className={styles.saveBtn}
              disabled={busy}
              onClick={() => void start("full")}
              data-testid="stocktake-start-full"
            >
              📋 جرد المحل كله
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                className={styles.input}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="القسم"
                data-testid="stocktake-category"
              >
                <option value="">اختار قسم…</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.undoBtn}
                disabled={busy || !category}
                onClick={() => void start("category")}
                data-testid="stocktake-start-category"
              >
                جرد القسم
              </button>
            </div>
            <input
              className={styles.input}
              dir="auto"
              placeholder="أو دوّر على أصناف معينة…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="stocktake-search"
            />
            {matches.map((v) => (
              <button
                key={v.variantId}
                type="button"
                className={styles.undoBtn}
                style={{ textAlign: "start" }}
                onClick={() => {
                  setPicked((p) => [...p, v.variantId]);
                  setSearch("");
                }}
              >
                ➕ {v.name}
              </button>
            ))}
            {picked.length > 0 && (
              <button
                type="button"
                className={styles.undoBtn}
                disabled={busy}
                onClick={() => void start("selected")}
                data-testid="stocktake-start-selected"
              >
                جرد {picked.length} صنف
              </button>
            )}
          </div>
        )}
        {overview && overview.history.length > 0 && (
          <div className={styles.listCard} data-testid="stocktake-history">
            {overview.history.map((h) => (
              <button
                key={h.id}
                type="button"
                className={styles.expenseRow}
                style={{ width: "100%", textAlign: "start" }}
                onClick={() => void openCount(h.id)}
              >
                <div className={styles.itemInfo}>
                  <b className={styles.itemCategory}>
                    {h.scope === "full"
                      ? "المحل كله"
                      : h.scope === "category"
                        ? h.category
                        : "أصناف معينة"}{" "}
                    · {STATUS[h.status]}
                  </b>
                  <span className={styles.itemMeta}>
                    {day(h.confirmedAt ?? h.startedAt)} · اتعدّ {h.counted}/
                    {h.lines} · فروق {h.discrepancies}
                    {h.damagedBase > 0 ? " · فيه تالف" : ""}
                  </span>
                </div>
                <b>
                  {h.shortageCostPiasters > 0
                    ? `−${formatMoney(h.shortageCostPiasters)}`
                    : "✓"}
                </b>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default StocktakeView;
