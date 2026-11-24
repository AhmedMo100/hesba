"use client";

/**
 * @file StocktakeView.tsx
 * @description «اعمل جرد» — a very simple, step-by-step stocktake (owner's design, 2026-11-23).
 *
 * 1. An unfinished count? «تكمل من حيث وقفت؟» → أكمل الجرد / ابدأ جرد جديد.
 * 2. New: كل المحل / قسم / منتجات معينة.
 * 3. One product at a time: name, المتوقع, الفعلي, then «التالي» (progress and what is left).
 * 4. A difference: المتوقع / الموجود / الفرق, then «ليه حصل الفرق؟» (تالف · مفقود ·
 *    اتباع ومتسجلش · خطأ في العد → count again · سبب آخر). The owner decides; nothing guesses.
 * 5. Summary → «راجع الجرد» → «تطبيق الجرد» → an explicit confirmation. Only then does the
 *    server change the stock, atomically and once (the confirm `opId`); «إلغاء» changes nothing.
 * 6. The report: date, who, scope, expected / actual / differences / reasons / values / what was
 *    applied — download (CSV) or share (WhatsApp…).
 *
 * The AI only helps (explains, summarises): «اسأل حسبة» opens the assistant with a question the
 * owner sends himself. The AI never changes stock or applies a count.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiGet } from "@/client/shared/api/read-cache";
import { formatMoney } from "@/client/shared/i18n";
import { isServiceProduct } from "@/domain/sale-pricing";
import {
  failureMessage,
  formatBaseQty,
  qtyUnitWord,
  toBaseQty,
  variantOptions,
  type StoreVariantOption,
} from "@/client/shared/quantity";
import { useToast } from "@/client/shared/ui";
import { shareReport, downloadFile } from "@/client/shared/share";
import { writeAiDraft } from "@/client/shared/ai-draft";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "./StocktakeView.module.css";
import {
  REASON_LABEL,
  buildReportCsv,
  buildReportText,
  reportFileName,
  scopeText,
  type CountReason,
  type ReportCount,
  type ReportLine,
} from "./stocktake-report";

interface Line extends ReportLine {
  variantId: string;
  differenceSellPiasters: number | null;
}
interface Count extends ReportCount {
  lines: Line[];
}
interface Overview {
  open: { id: string } | null;
  history: Array<{
    id: string;
    scope: string;
    category: string | null;
    status: string;
    startedAt: string;
    confirmedAt: string | null;
    lines: number;
    discrepancies: number;
  }>;
}

type Step =
  | "home"
  | "pickCategory"
  | "pickProducts"
  | "count"
  | "summary"
  | "review"
  | "confirm"
  | "report";

/** The answers to «ليه حصل الفرق؟» («خطأ في العد» is not a reason: the owner counts again). */
const SHORTAGE_CHOICES: Array<[CountReason | "recount", string, string]> = [
  ["damaged", "🗑️", "تالف"],
  ["lost", "❓", "مفقود"],
  ["unrecorded_sale", "🛒", "اتباع ومتسجلش"],
  ["recount", "🔁", "خطأ في العد"],
  ["unknown", "…", "سبب آخر"],
];

/** «−3» / «+1 ك» kept left-to-right inside the Arabic text (else it reads «3−»). */
const signed = (unit: string, d: number) => (
  <bdi dir="ltr">
    {d > 0 ? "+" : "−"}
    {formatBaseQty(unit, Math.abs(d))}
  </bdi>
);

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "long",
  });

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

export function StocktakeView({
  onNavigate,
}: { onNavigate?: (route: NavRoute) => void } = {}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("home");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [count, setCount] = useState<Count | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<StoreVariantOption[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Counting one product at a time.
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState<CountReason | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadOverview = useCallback(() => {
    fetch("/api/inventory-counts", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(await errorText(r, "حصلت مشكلة. جرّب تاني."));
        return (await r.json()) as Overview;
      })
      .then((o) => {
        setOverview(o);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(failureMessage(e, "حصلت مشكلة. جرّب تاني.")),
      );
  }, []);
  useEffect(loadOverview, [loadOverview]);
  useEffect(() => {
    apiGet("/api/products?scope=store")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) =>
        setVariants(
          variantOptions(d).filter(
            (v) => !isServiceProduct({ unit: v.unit, category: v.category }),
          ),
        ),
      )
      .catch(() => {});
  }, []);
  const categories = useMemo(
    () => [...new Set(variants.map((v) => v.category).filter(Boolean))].sort(),
    [variants],
  );

  /** Puts the line at `i` on screen with what was already counted for it. */
  const showLine = useCallback((c: Count, i: number) => {
    const safe = Math.max(0, Math.min(i, c.lines.length - 1));
    const l = c.lines[safe];
    setIndex(safe);
    setTyped(
      l && l.countedBase !== null
        ? l.unit === "kg"
          ? String(l.countedBase / 1000)
          : String(l.countedBase)
        : "",
    );
    setReason(l && l.reason && l.reason !== "surplus" ? l.reason : null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const openCount = useCallback(
    async (id: string, then: Step) => {
      setError(null);
      const r = await fetch(`/api/inventory-counts/${id}`, {
        credentials: "same-origin",
      });
      if (!r.ok) return setError(await errorText(r, "مقدرناش نفتح الجرد"));
      const c = ((await r.json()) as { count: Count }).count;
      setCount(c);
      if (then === "count") {
        // Resume at the first product not counted yet.
        const next = c.lines.findIndex((l) => l.countedBase === null);
        showLine(c, next === -1 ? c.lines.length - 1 : next);
      }
      setStep(c.status === "open" ? then : "report");
    },
    [showLine],
  );

  const start = async (
    scope: "full" | "category" | "selected",
    category?: string,
  ) => {
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
      if (c.lines.length === 0) {
        setError("مفيش منتجات في الجرد ده.");
        return;
      }
      setCount(c);
      setPicked([]);
      showLine(c, 0);
      setStep("count");
      loadOverview();
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نبدأ الجرد"));
    } finally {
      setBusy(false);
    }
  };

  /** «ابدأ جرد جديد» while one is open: the open one is cancelled first (no stock change). */
  const startOver = async () => {
    if (!overview?.open) return setStep("home");
    if (
      !window.confirm(
        "الجرد اللي مخلصش هيتلغي (المخزون مش هيتغير) وتبدأ جرد جديد. موافق؟",
      )
    )
      return;
    const res = await fetch(
      `/api/inventory-counts/${overview.open.id}/abandon`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    if (!res.ok) return setError(await errorText(res, "مقدرناش نلغي"));
    setCount(null);
    loadOverview();
    setStep("home");
  };

  const line = count?.lines[index];
  const typedBase = line ? toBaseQty(line.unit, typed) : null;
  const diff =
    line && typedBase !== null ? typedBase - line.expectedBase : null;

  /** Saves the shown product, then moves by `delta` (or to the summary after the last one). */
  const saveAndMove = async (delta: number) => {
    if (!count || !line) return;
    setError(null);
    if (typed.trim() !== "" && typedBase === null) {
      return setError(`اكتب الكمية صح (${qtyUnitWord(line.unit)})`);
    }
    if (diff !== null && diff < 0 && !reason) {
      return setError("اختار ليه حصل الفرق");
    }
    const changed =
      typedBase !== line.countedBase ||
      (diff !== null && diff < 0 && reason !== line.reason);
    let c: Count = count;
    if (changed) {
      setBusy(true);
      try {
        const res = await fetch(`/api/inventory-counts/${count.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: [
              {
                variantId: line.variantId,
                countedBase: typedBase,
                reason: diff !== null && diff < 0 ? reason : null,
              },
            ],
          }),
        });
        if (!res.ok) throw new Error(await errorText(res, "مقدرناش نحفظ"));
        c = ((await res.json()) as { count: Count }).count;
        setCount(c);
      } catch (e: unknown) {
        setBusy(false);
        return setError(failureMessage(e, "مقدرناش نحفظ"));
      }
      setBusy(false);
    }
    const next = index + delta;
    if (next >= c.lines.length) return setStep("summary");
    showLine(c, next);
  };

  const apply = async () => {
    if (!count) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventory-counts/${count.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opId: crypto.randomUUID() }),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نطبّق الجرد"));
      setCount(((await res.json()) as { count: Count }).count);
      setStep("report");
      loadOverview();
      window.dispatchEvent(new Event("hesba_stock_updated"));
      toast.show({ msg: "الجرد اتطبّق على المخزون ✓", kind: "ok" });
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نطبّق الجرد"));
      setStep("summary");
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
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return setError(await errorText(res, "مقدرناش نلغي"));
    setCount(null);
    loadOverview();
    setStep("home");
  };

  const askHesba = (question: string) => {
    writeAiDraft(question);
    onNavigate?.("ai");
  };

  const share = async (c: Count) => {
    const result = await shareReport({
      title: `تقرير جرد — ${scopeText(c)}`,
      text: buildReportText(c),
      file: {
        name: reportFileName(c, "csv"),
        content: buildReportCsv(c),
        mime: "text/csv;charset=utf-8",
      },
    });
    if (result === "downloaded")
      toast.show({ msg: "التقرير اتنزل ✓", kind: "ok" });
    if (result === "copied") toast.show({ msg: "التقرير اتنسخ ✓", kind: "ok" });
  };

  const errorBox = error && (
    <p className={styles.error} role="alert" data-testid="stocktake-error">
      {error}
    </p>
  );

  // ── 1. Start: resume an unfinished count, or a new one ──
  if (step === "home") {
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          {errorBox}
          {error && !overview && (
            <button
              type="button"
              className={styles.ghost}
              onClick={loadOverview}
            >
              جرّب تاني
            </button>
          )}
          {!overview && !error && <p className={styles.muted}>بنحمّل…</p>}
          {overview?.open ? (
            <div className={styles.card} data-testid="stocktake-resume">
              <h2 className={styles.h2}>عندك جرد لسه مخلصش</h2>
              <p className={styles.muted}>تكمل من حيث وقفت؟</p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void openCount(overview.open!.id, "count")}
                data-testid="stocktake-continue"
              >
                أكمل الجرد
              </button>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => void startOver()}
                data-testid="stocktake-start-over"
              >
                ابدأ جرد جديد
              </button>
            </div>
          ) : (
            overview && (
              <>
                <h2 className={styles.h2}>هتجرد إيه؟</h2>
                <button
                  type="button"
                  className={styles.choice}
                  disabled={busy}
                  onClick={() => void start("full")}
                  data-testid="stocktake-start-full"
                >
                  <span aria-hidden="true">🏪</span>
                  <b>كل المحل</b>
                  <small>كل المنتجات</small>
                </button>
                <button
                  type="button"
                  className={styles.choice}
                  disabled={busy || categories.length === 0}
                  onClick={() => setStep("pickCategory")}
                  data-testid="stocktake-start-category"
                >
                  <span aria-hidden="true">🗂️</span>
                  <b>قسم</b>
                  <small>مثلاً البقالة بس</small>
                </button>
                <button
                  type="button"
                  className={styles.choice}
                  disabled={busy || variants.length === 0}
                  onClick={() => setStep("pickProducts")}
                  data-testid="stocktake-start-selected"
                >
                  <span aria-hidden="true">✅</span>
                  <b>منتجات معينة</b>
                  <small>تختارها بنفسك</small>
                </button>
              </>
            )
          )}

          <button
            type="button"
            className={styles.help}
            onClick={() =>
              askHesba(
                "مش عارف أعمل الجرد. اشرحلي خطوة خطوة إزاي أجرد محلي في حِسبة.",
              )
            }
            data-testid="stocktake-ask-howto"
          >
            💬 مش عارف أعمل الجرد؟ اسأل حسبة
          </button>

          {overview && overview.history.some((h) => h.status !== "open") && (
            <>
              <h3 className={styles.h3}>الجرد اللي فات</h3>
              <div className={styles.list}>
                {overview.history
                  .filter((h) => h.status !== "open")
                  .slice(0, 10)
                  .map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className={styles.row}
                      onClick={() => void openCount(h.id, "report")}
                      data-testid="stocktake-history-row"
                    >
                      <span>
                        <b>{scopeText(h)}</b>
                        <small>
                          {day(h.confirmedAt ?? h.startedAt)} ·{" "}
                          {h.status === "confirmed" ? "اتطبّق" : "اتلغى"}
                        </small>
                      </span>
                      <small>
                        {h.discrepancies > 0
                          ? `${h.discrepancies} فرق`
                          : "مظبوط"}
                      </small>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── 2a. Pick a category ──
  if (step === "pickCategory") {
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <h2 className={styles.h2}>اختار القسم</h2>
          {errorBox}
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={styles.choice}
              disabled={busy}
              onClick={() => void start("category", cat)}
              data-testid="stocktake-category"
            >
              <b>{cat}</b>
              <small>
                {variants.filter((v) => v.category === cat).length} منتج
              </small>
            </button>
          ))}
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setStep("home")}
          >
            رجوع
          </button>
        </div>
      </div>
    );
  }

  // ── 2b. Pick products ──
  if (step === "pickProducts") {
    const shown = variants.filter(
      (v) => !search.trim() || v.name.includes(search.trim()),
    );
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <h2 className={styles.h2}>اختار المنتجات</h2>
          <input
            className={styles.input}
            placeholder="دوّر على منتج…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="stocktake-search"
          />
          {errorBox}
          <div className={styles.list}>
            {shown.slice(0, 200).map((v) => {
              const on = picked.includes(v.variantId);
              return (
                <label
                  key={v.variantId}
                  className={`${styles.row} ${on ? styles.rowOn : ""}`}
                >
                  <span>
                    <b>{v.name}</b>
                    <small>عندك {formatBaseQty(v.unit, v.stockBase)}</small>
                  </span>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={on}
                    onChange={() =>
                      setPicked((p) =>
                        on
                          ? p.filter((x) => x !== v.variantId)
                          : [...p, v.variantId],
                      )
                    }
                    data-testid="stocktake-pick"
                  />
                </label>
              );
            })}
          </div>
          <div className={styles.stickyBar}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || picked.length === 0}
              onClick={() => void start("selected")}
              data-testid="stocktake-start-picked"
            >
              ابدأ الجرد ({picked.length})
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setStep("home")}
            >
              رجوع
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!count) return null;
  const t = count.totals;
  const diffs = count.lines.filter(
    (l) => l.differenceBase !== null && l.differenceBase !== 0,
  );

  // ── 3–4. One product at a time ──
  if (step === "count" && line) {
    const total = count.lines.length;
    const left = count.lines.filter((l) => l.countedBase === null).length;
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <div className={styles.progressHead}>
            <span data-testid="stocktake-progress">
              منتج {index + 1} من {total}
            </span>
            <span>باقي {left}</span>
          </div>
          <div className={styles.progress}>
            <span style={{ width: `${((total - left) / total) * 100}%` }} />
          </div>

          <div className={styles.card} data-testid="stocktake-line">
            <h2 className={styles.product}>{line.productName}</h2>
            <p className={styles.expected}>
              المتوقع: <b>{formatBaseQty(line.unit, line.expectedBase)}</b>{" "}
              {qtyUnitWord(line.unit)}
            </p>
            <label className={styles.lbl} htmlFor="st-actual">
              الفعلي ({qtyUnitWord(line.unit)})
            </label>
            <input
              id="st-actual"
              ref={inputRef}
              className={styles.bigInput}
              inputMode="decimal"
              placeholder="عدّ واكتب هنا"
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveAndMove(1);
              }}
              data-testid="stocktake-count"
            />

            {diff !== null && diff !== 0 && (
              <div className={styles.diffBox} data-testid="stocktake-diff">
                <div className={styles.diffNums}>
                  <span>
                    المتوقع <b>{formatBaseQty(line.unit, line.expectedBase)}</b>
                  </span>
                  <span>
                    الموجود <b>{formatBaseQty(line.unit, typedBase!)}</b>
                  </span>
                  <span className={diff < 0 ? styles.neg : styles.pos}>
                    الفرق <b>{signed(line.unit, diff)}</b>
                  </span>
                </div>
                {diff < 0 ? (
                  <>
                    <p className={styles.why}>ليه حصل الفرق؟</p>
                    <div className={styles.reasons}>
                      {SHORTAGE_CHOICES.map(([k, icon, label]) => (
                        <button
                          key={k}
                          type="button"
                          className={`${styles.reason} ${reason === k ? styles.reasonOn : ""}`}
                          onClick={() => {
                            if (k === "recount") {
                              setTyped("");
                              setReason(null);
                              inputRef.current?.focus();
                              return;
                            }
                            setReason(k);
                            setError(null);
                          }}
                          data-testid={`stocktake-reason-${k}`}
                        >
                          <span aria-hidden="true">{icon}</span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className={styles.muted}>
                    زيادة عن المتسجل: هترجع للمخزون بسعر الشراء (مش مشتريات).
                  </p>
                )}
              </div>
            )}
            {diff === 0 && <p className={styles.ok}>✓ مظبوط</p>}
          </div>

          {errorBox}
          <div className={styles.stickyBar}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void saveAndMove(1)}
              data-testid="stocktake-next"
            >
              {index + 1 >= total ? "خلصت ←" : "التالي ←"}
            </button>
            <div className={styles.twoBtns}>
              <button
                type="button"
                className={styles.ghost}
                disabled={busy || index === 0}
                onClick={() => void saveAndMove(-1)}
              >
                → السابق
              </button>
              <button
                type="button"
                className={styles.ghost}
                disabled={busy}
                onClick={() => setStep("summary")}
                data-testid="stocktake-to-summary"
              >
                الملخص
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 5. Summary, review, confirmation ──
  if (step === "summary" || step === "review" || step === "confirm") {
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <h2 className={styles.h2}>ملخص الجرد</h2>
          <div className={styles.stats} data-testid="stocktake-summary">
            <div>
              <small>اتعدّ</small>
              <b>
                {t.counted} من {t.lines}
              </b>
            </div>
            <div>
              <small>ناقص</small>
              <b>{diffs.filter((l) => l.differenceBase! < 0).length}</b>
            </div>
            <div>
              <small>زيادة</small>
              <b>{diffs.filter((l) => l.differenceBase! > 0).length}</b>
            </div>
            <div>
              <small>قيمة الناقص</small>
              <b>{formatMoney(t.shortageCostPiasters)}</b>
            </div>
          </div>
          {t.surplusCostPiasters > 0 && (
            <p className={styles.muted}>
              قيمة الزيادة: {formatMoney(t.surplusCostPiasters)} (بسعر الشراء)
            </p>
          )}
          {diffs.some((l) => l.differenceBase! < 0) && (
            <div className={styles.card}>
              <b>الأسباب</b>
              {(["damaged", "lost", "unrecorded_sale", "unknown"] as const)
                .map(
                  (k) =>
                    [k, diffs.filter((l) => l.reason === k).length] as const,
                )
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <p key={k} className={styles.reasonLine}>
                    {REASON_LABEL[k]}: {n} منتج
                  </p>
                ))}
              {t.unrecordedSaleBase > 0 && (
                <p className={styles.muted}>
                  {count.salesMode === "simple"
                    ? "«اتباع»: فلوسه في إجمالي المبيعات اليومي، فمش هيتحسب مبيعات تاني."
                    : "«اتباع ومتسجلش» هيتحسب مبيعات اكتشفها الجرد (من غير فلوس جديدة في الدرج)."}
                </p>
              )}
            </div>
          )}
          {t.counted < t.lines && (
            <p className={styles.muted}>
              {t.lines - t.counted} منتج ما اتعدّش: مش هيتغير.
            </p>
          )}

          {step === "review" && (
            <div className={styles.list} data-testid="stocktake-review">
              {diffs.length === 0 && (
                <p className={styles.muted}>كل اللي اتعدّ مظبوط.</p>
              )}
              {diffs.map((l) => (
                <button
                  key={l.variantId}
                  type="button"
                  className={styles.row}
                  onClick={() => {
                    showLine(
                      count,
                      count.lines.findIndex((x) => x.variantId === l.variantId),
                    );
                    setStep("count");
                  }}
                >
                  <span>
                    <b>{l.productName}</b>
                    <small>
                      المتوقع {formatBaseQty(l.unit, l.expectedBase)} · الموجود{" "}
                      {formatBaseQty(l.unit, l.countedBase ?? 0)}
                      {l.reason ? ` · ${REASON_LABEL[l.reason]}` : ""}
                    </small>
                  </span>
                  <b
                    className={l.differenceBase! < 0 ? styles.neg : styles.pos}
                  >
                    {signed(l.unit, l.differenceBase!)}
                  </b>
                </button>
              ))}
            </div>
          )}

          {errorBox}

          {step === "confirm" ? (
            <div
              className={styles.confirm}
              role="alertdialog"
              data-testid="stocktake-confirm-box"
            >
              <p>
                <b>أنت على وشك تطبيق الجرد وتعديل كميات المخزون.</b>
              </p>
              <p>بعد التطبيق مش هتقدر تعدّل الجرد ده.</p>
              <button
                type="button"
                className={styles.danger}
                disabled={busy}
                onClick={() => void apply()}
                data-testid="stocktake-confirm"
              >
                {busy ? "بيتطبّق…" : "تأكيد وتطبيق الجرد"}
              </button>
              <button
                type="button"
                className={styles.ghost}
                disabled={busy}
                onClick={() => setStep("review")}
                data-testid="stocktake-confirm-cancel"
              >
                إلغاء
              </button>
            </div>
          ) : (
            <div className={styles.stickyBar}>
              {step === "summary" ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => setStep("review")}
                  data-testid="stocktake-review-open"
                >
                  راجع الجرد
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || t.counted === 0}
                  onClick={() => setStep("confirm")}
                  data-testid="stocktake-apply"
                >
                  تطبيق الجرد
                </button>
              )}
              <div className={styles.twoBtns}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    const next = count.lines.findIndex(
                      (l) => l.countedBase === null,
                    );
                    showLine(count, next === -1 ? 0 : next);
                    setStep("count");
                  }}
                >
                  كمّل العدّ
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => void abandon()}
                  data-testid="stocktake-abandon"
                >
                  إلغاء الجرد
                </button>
              </div>
              {diffs.length > 0 && (
                <button
                  type="button"
                  className={styles.help}
                  onClick={() =>
                    askHesba(
                      `حلّلّي فروق الجرد ده قبل ما أطبّقه:\n${buildReportText(count)}`,
                    )
                  }
                  data-testid="stocktake-ask-diffs"
                >
                  💬 اسأل حسبة عن الفروق دي
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 6. The report (a confirmed or cancelled count) ──
  return (
    <div className={viewStyles.view} data-testid="page-stocktake">
      <div className={styles.wrap} data-testid="stocktake-report">
        <h2 className={styles.h2}>تقرير الجرد</h2>
        <div className={styles.card}>
          <p>
            <b>{scopeText(count)}</b> ·{" "}
            {day(count.confirmedAt ?? count.abandonedAt ?? count.startedAt)}
          </p>
          {count.startedBy && (
            <p className={styles.muted}>بدأه: {count.startedBy}</p>
          )}
          {count.closedBy && (
            <p className={styles.muted}>
              {count.status === "confirmed" ? "طبّقه" : "لغاه"}:{" "}
              {count.closedBy}
            </p>
          )}
          <p
            className={count.status === "confirmed" ? styles.ok : styles.muted}
          >
            {count.status === "confirmed"
              ? "✅ اتطبّق على المخزون مرة واحدة"
              : "اتلغى: المخزون ما اتغيرش"}
          </p>
        </div>
        <div className={styles.stats}>
          <div>
            <small>اتعدّ</small>
            <b>
              {t.counted} من {t.lines}
            </b>
          </div>
          <div>
            <small>فيه فرق</small>
            <b>{t.discrepancies}</b>
          </div>
          <div>
            <small>قيمة الناقص</small>
            <b>{formatMoney(t.shortageCostPiasters)}</b>
          </div>
          <div>
            <small>قيمة الزيادة</small>
            <b>{formatMoney(t.surplusCostPiasters)}</b>
          </div>
        </div>
        <div className={styles.list}>
          {diffs.map((l) => (
            <div key={l.variantId} className={styles.row}>
              <span>
                <b>{l.productName}</b>
                <small>
                  المتوقع {formatBaseQty(l.unit, l.expectedBase)} · الموجود{" "}
                  {formatBaseQty(l.unit, l.countedBase ?? 0)}
                  {l.reason ? ` · ${REASON_LABEL[l.reason]}` : ""}
                  {l.appliedCostPiasters != null
                    ? ` · ${formatMoney(l.appliedCostPiasters)}`
                    : ""}
                </small>
              </span>
              <b className={l.differenceBase! < 0 ? styles.neg : styles.pos}>
                {signed(l.unit, l.differenceBase!)}
              </b>
            </div>
          ))}
          {diffs.length === 0 && <p className={styles.muted}>مفيش فروق.</p>}
        </div>
        <div className={styles.twoBtns}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void share(count)}
            data-testid="stocktake-share"
          >
            📤 شارك التقرير
          </button>
          <button
            type="button"
            className={styles.ghost}
            onClick={() =>
              downloadFile({
                name: reportFileName(count, "csv"),
                content: buildReportCsv(count),
                mime: "text/csv;charset=utf-8",
              })
            }
            data-testid="stocktake-download"
          >
            ⬇️ نزّل
          </button>
        </div>
        <button
          type="button"
          className={styles.help}
          onClick={() =>
            askHesba(
              `اكتبلي تقرير واضح بالمصري عن الجرد ده:\n${buildReportText(count)}`,
            )
          }
          data-testid="stocktake-ask-report"
        >
          💬 خلي حسبة تكتبلك تقرير عنه
        </button>
        <button
          type="button"
          className={styles.ghost}
          onClick={() => {
            setCount(null);
            setStep("home");
          }}
        >
          خلاص
        </button>
      </div>
    </div>
  );
}

export default StocktakeView;
