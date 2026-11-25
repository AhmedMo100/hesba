"use client";

/**
 * @file StocktakeView.tsx
 * @description «الجرد» — a very simple, step-by-step stocktake (owner's design, ADR-0036).
 *
 * 1. «الجرد»: an unfinished count's summary (أكمل / ابدأ جديد), one big «اعمل جرد جديد», and the
 *    past counts (a small filter: الكل · اتطبّق · اتلغى) — each opens its report.
 * 2. New, one choice per screen: كل المنتجات / قسم / منتجات معينة.
 * 3. One product at a time: «العدد في حِسبة: 20», «عدّ الموجود عندك: [ 17 ]», «التالي», with the
 *    progress. (Hesba has no product photos: a placeholder stands in for one.)
 * 4. A shortage asks «الـ 3 قطع دول حصل فيهم إيه؟»: اتباع ومتسجلش · تالف · منتهي الصلاحية · مفقود ·
 *    سبب آخر (a note for تالف / منتهي / سبب آخر). A surplus asks where it came from (kept as a
 *    stock adjustment with its note — never a purchase). The owner decides; nothing guesses, and
 *    a difference is never turned into a sale by itself: «اتباع ومتسجلش» follows the package's
 *    rule (الكاشير الذكي: a sale the count discovered, no money; إدارة المحل: its money is already
 *    in the daily total), shown before confirming.
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
import { Icon } from "@/client/shared/ui";
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
    counted: number;
    discrepancies: number;
  }>;
}

type Step =
  | "home"
  | "scope"
  | "pickCategory"
  | "pickProducts"
  | "count"
  | "summary"
  | "review"
  | "confirm"
  | "report";

/** The answers to «حصل فيهم إيه؟» (a counting mistake is not a reason: «عدّ تاني»). */
const SHORTAGE_CHOICES: Array<[CountReason, string, string]> = [
  ["unrecorded_sale", "🛒", "اتباع ومتسجلش"],
  ["damaged", "🗑️", "تالف"],
  ["expired", "⏰", "منتهي الصلاحية"],
  ["lost", "❓", "مفقود"],
  ["unknown", "✍️", "سبب آخر"],
];
/** Reasons that take a note. */
const NOTE_REASONS: ReadonlySet<CountReason> = new Set([
  "damaged",
  "expired",
  "unknown",
]);
/** Where a surplus came from (kept as the line's note; the stock adjustment is the same). */
const SURPLUS_CHOICES = [
  "بضاعة دخلت ومتسجلتش",
  "مرتجع من زبون",
  "كانت متسجلة أقل من الحقيقة",
] as const;
const SURPLUS_OTHER = "سبب آخر";

type HistoryFilter = "all" | "confirmed" | "abandoned";

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
  // The owner's note on the shown product's difference (a surplus: where it came from).
  const [note, setNote] = useState("");
  const [surplusWhy, setSurplusWhy] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
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
    const saved = l?.note ?? "";
    if (l?.reason === "surplus" && saved) {
      const preset = (SURPLUS_CHOICES as readonly string[]).includes(saved);
      setSurplusWhy(preset ? saved : SURPLUS_OTHER);
      setNote(preset ? "" : saved);
    } else {
      setSurplusWhy(null);
      setNote(saved);
    }
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

  /** «اعمل جرد جديد»: straight to «هتجرد إيه؟». While a count is still open, that one is
   *  cancelled first (after a confirm; no stock change). */
  const startNew = async () => {
    if (!overview?.open) return setStep("scope");
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
    setStep("scope");
  };

  /** Back one step inside the stocktake: an arrow only (the page header has its own). */
  const stepBack = (to: Step) => (
    <button
      type="button"
      className={styles.stepBack}
      onClick={() => setStep(to)}
      aria-label="رجوع"
      data-testid="stocktake-step-back"
    >
      <Icon n="back" s={24} sw={2.6} />
    </button>
  );

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
      return setError("اختار حصل إيه في الفرق ده");
    }
    if (diff !== null && diff > 0 && !surplusWhy) {
      return setError("اختار الزيادة جت منين");
    }
    // The note sent with the line: a surplus' origin, or the owner's words on a shortage.
    const lineNote =
      diff === null || diff === 0
        ? null
        : diff > 0
          ? surplusWhy === SURPLUS_OTHER
            ? note.trim() || null
            : surplusWhy
          : reason && NOTE_REASONS.has(reason)
            ? note.trim() || null
            : null;
    if (
      diff !== null &&
      diff > 0 &&
      surplusWhy === SURPLUS_OTHER &&
      !lineNote
    ) {
      return setError("اكتب الزيادة جت منين");
    }
    const changed =
      typedBase !== line.countedBase ||
      (diff !== null && diff < 0 && reason !== line.reason) ||
      (diff !== null && diff !== 0 && lineNote !== (line.note ?? null));
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
                note: lineNote,
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

  // ── 1. «الجرد»: the unfinished count, «اعمل جرد جديد», and the past counts ──
  if (step === "home") {
    const openRow = overview?.open
      ? overview.history.find((h) => h.id === overview.open!.id)
      : undefined;
    const past = (overview?.history ?? []).filter(
      (h) =>
        h.status !== "open" &&
        (historyFilter === "all" || h.status === historyFilter),
    );
    const hasPast = (overview?.history ?? []).some((h) => h.status !== "open");
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <h2 className={styles.h2}>الجرد</h2>
          <button
            type="button"
            className={styles.bigStart}
            onClick={() => void startNew()}
            data-testid="stocktake-new"
          >
            <span aria-hidden="true">📋</span>
            اعمل جرد جديد
          </button>
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
          {overview?.open && (
            <div className={styles.card} data-testid="stocktake-resume">
              <b>عندك جرد لسه مخلصش</b>
              <p className={styles.muted}>
                {openRow
                  ? `${scopeText(openRow)} · اتعدّ ${openRow.counted} من ${openRow.lines} · بدأ ${day(openRow.startedAt)}`
                  : "تكمل من حيث وقفت؟"}
              </p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void openCount(overview.open!.id, "count")}
                data-testid="stocktake-continue"
              >
                أكمل الجرد
              </button>
            </div>
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

          {hasPast && (
            <>
              <h3 className={styles.h3}>الجرد اللي فات</h3>
              <div className={styles.filter} role="tablist">
                {(
                  [
                    ["all", "الكل"],
                    ["confirmed", "اتطبّق"],
                    ["abandoned", "اتلغى"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={historyFilter === k}
                    className={`${styles.filterChip} ${historyFilter === k ? styles.filterOn : ""}`}
                    onClick={() => setHistoryFilter(k)}
                    data-testid={`stocktake-filter-${k}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className={styles.list}>
                {past.length === 0 && (
                  <p className={styles.muted}>مفيش جرد بالحالة دي.</p>
                )}
                {past.slice(0, 15).map((h) => (
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
                        {h.status === "confirmed" ? "اتطبّق ✅" : "اتلغى"}
                      </small>
                    </span>
                    <small>
                      {h.discrepancies > 0 ? `${h.discrepancies} فرق` : "مظبوط"}
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

  // ── 2. A new count: what to count (one choice per screen) ──
  if (step === "scope") {
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <div className={styles.stepHead}>
            {stepBack("home")}
            <h2 className={styles.h2}>هتجرد إيه؟</h2>
          </div>
          {errorBox}
          <button
            type="button"
            className={styles.choice}
            disabled={busy}
            onClick={() => void start("full")}
            data-testid="stocktake-start-full"
          >
            <span aria-hidden="true">🏪</span>
            <b>كل المنتجات</b>
            <small>كل اللي في المحل</small>
          </button>
          <button
            type="button"
            className={styles.choice}
            disabled={busy || categories.length === 0}
            onClick={() => setStep("pickCategory")}
            data-testid="stocktake-start-category"
          >
            <span aria-hidden="true">🗂️</span>
            <b>قسم معيّن</b>
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
            <b>منتجات محددة</b>
            <small>تختارها بنفسك</small>
          </button>
        </div>
      </div>
    );
  }

  // ── 2a. Pick a category ──
  if (step === "pickCategory") {
    return (
      <div className={viewStyles.view} data-testid="page-stocktake">
        <div className={styles.wrap}>
          <div className={styles.stepHead}>
            {stepBack("scope")}
            <h2 className={styles.h2}>اختار القسم</h2>
          </div>
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
          <div className={styles.stepHead}>
            {stepBack("scope")}
            <h2 className={styles.h2}>اختار المنتجات</h2>
          </div>
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
            <div className={styles.productHead}>
              {/* No product photos in Hesba yet: the first letter stands in for one. */}
              <span className={styles.photo} aria-hidden="true">
                {line.productName.trim().charAt(0) || "📦"}
              </span>
              <span>
                <h2 className={styles.product}>{line.productName}</h2>
                {line.category && (
                  <small className={styles.muted}>{line.category}</small>
                )}
              </span>
            </div>
            <p className={styles.expected} data-testid="stocktake-expected">
              العدد في حِسبة:{" "}
              <b>{formatBaseQty(line.unit, line.expectedBase)}</b>{" "}
              {qtyUnitWord(line.unit)}
            </p>
            <label className={styles.lbl} htmlFor="st-actual">
              عدّ الموجود عندك ({qtyUnitWord(line.unit)})
            </label>
            <input
              id="st-actual"
              ref={inputRef}
              className={styles.bigInput}
              inputMode="decimal"
              placeholder="اكتب العدد"
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
                    <p className={styles.why} data-testid="stocktake-why">
                      الـ {formatBaseQty(line.unit, -diff)}{" "}
                      {qtyUnitWord(line.unit)} دول حصل فيهم إيه؟
                    </p>
                    <div className={styles.reasons}>
                      {SHORTAGE_CHOICES.map(([k, icon, label]) => (
                        <button
                          key={k}
                          type="button"
                          className={`${styles.reason} ${reason === k ? styles.reasonOn : ""}`}
                          onClick={() => {
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
                    {reason && NOTE_REASONS.has(reason) && (
                      <input
                        className={styles.noteInput}
                        dir="auto"
                        maxLength={300}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          reason === "unknown"
                            ? "اكتب السبب"
                            : "ملاحظة (اختياري): مثلاً اتكسر في النقل"
                        }
                        aria-label="ملاحظة"
                        data-testid="stocktake-note"
                      />
                    )}
                    {reason === "unrecorded_sale" && (
                      <p
                        className={styles.muted}
                        data-testid="stocktake-sold-effect"
                      >
                        {(count.salesMode ?? "pos") === "simple"
                          ? "فلوسه في إجمالي المبيعات اليومي: هيتخصم من المخزون بس، ومش هيتحسب بيع تاني."
                          : "هيتحسب بيع اكتشفه الجرد بسعر البيع، من غير فلوس جديدة في الدرج."}
                      </p>
                    )}
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => {
                        setTyped("");
                        setReason(null);
                        setNote("");
                        inputRef.current?.focus();
                      }}
                      data-testid="stocktake-recount"
                    >
                      🔁 غلطت في العد؟ عدّ تاني
                    </button>
                  </>
                ) : (
                  <>
                    <p className={styles.why} data-testid="stocktake-why">
                      الزيادة دي ({formatBaseQty(line.unit, diff)}{" "}
                      {qtyUnitWord(line.unit)}) جت منين؟
                    </p>
                    <div className={styles.reasons}>
                      {[...SURPLUS_CHOICES, SURPLUS_OTHER].map((k, i) => (
                        <button
                          key={k}
                          type="button"
                          className={`${styles.reason} ${surplusWhy === k ? styles.reasonOn : ""}`}
                          onClick={() => {
                            setSurplusWhy(k);
                            setError(null);
                          }}
                          data-testid={`stocktake-surplus-${i}`}
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                    {surplusWhy === SURPLUS_OTHER && (
                      <input
                        className={styles.noteInput}
                        dir="auto"
                        maxLength={300}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="اكتب السبب"
                        aria-label="السبب"
                        data-testid="stocktake-note"
                      />
                    )}
                    <p className={styles.muted}>
                      هترجع للمخزون كتعديل جرد بسعر الشراء: مش مشتريات ومش فلوس.
                    </p>
                  </>
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
              <small>منتجات ناقصة</small>
              <b>
                {t.shortageLines ??
                  diffs.filter((l) => l.differenceBase! < 0).length}
              </b>
            </div>
            <div>
              <small>منتجات زيادة</small>
              <b>
                {t.surplusLines ??
                  diffs.filter((l) => l.differenceBase! > 0).length}
              </b>
            </div>
            <div>
              <small>قيمة الفروق</small>
              <b data-testid="stocktake-diff-value">
                {formatMoney(t.shortageCostPiasters + t.surplusCostPiasters)}
              </b>
            </div>
          </div>
          <div className={styles.card} data-testid="stocktake-reasons">
            {(
              [
                ["damaged", "🗑️ تالف"],
                ["expired", "⏰ منتهي الصلاحية"],
                ["unrecorded_sale", "🛒 اتباع ومتسجلش"],
                ["lost", "❓ مفقود"],
                ["unknown", "✍️ سبب آخر"],
              ] as const
            ).map(([k, label]) => (
              <p key={k} className={styles.reasonLine}>
                <span>{label}</span>
                <b>{diffs.filter((l) => l.reason === k).length} منتج</b>
              </p>
            ))}
            <p className={styles.muted}>
              الناقص بسعر الشراء: {formatMoney(t.shortageCostPiasters)}
              {t.surplusCostPiasters > 0
                ? ` · الزيادة: ${formatMoney(t.surplusCostPiasters)}`
                : ""}
            </p>
            {t.unrecordedSaleBase > 0 && (
              <p className={styles.muted} data-testid="stocktake-money-effect">
                {count.salesMode === "simple"
                  ? "«اتباع ومتسجلش»: فلوسه في إجمالي المبيعات اليومي، فمش هيتحسب مبيعات تاني."
                  : `«اتباع ومتسجلش» هيتحسب مبيعات اكتشفها الجرد بـ ${formatMoney(t.unrecordedSaleSellPiasters ?? 0)} (من غير فلوس جديدة في الدرج).`}
              </p>
            )}
            <p className={styles.muted}>
              التالف والمنتهي والمفقود بيتحسبوا خسارة بسعر الشراء. الجرد مش
              بيعمل مبيعات ولا بيحرّك فلوس لوحده.
            </p>
          </div>
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
                      {l.note ? ` · ${l.note}` : ""}
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
