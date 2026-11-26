"use client";

/**
 * @file StocktakeView.tsx
 * @description «الجرد» (ADR-0039): open → pick a section → scan and count → Hesba compares →
 * the differences, each with its reason → confirm.
 *
 * 1. «الجرد»: three short steps, «اعمل جرد جديد», an unfinished count (أكمل), past counts.
 * 2. «اختار قسم»: each section with its number of products (from the server: the page never
 *    loads the shop's whole product list), or «كل المحل».
 * 3. Counting ({@link StocktakeCounter}): barcode, search, the lists «لسه» / «اتعدّ».
 * 4. «نتيجة الجرد»: four cards (اتعدّ · فيه فرق · ناقص · زيادة), the shortages and the surpluses,
 *    the money effect (only what the server computed), three small charts, then «راجع وأكّد» →
 *    an explicit confirmation. Only then does the server change the stock — atomically, once
 *    (the confirm `opId`). «إلغاء الجرد» changes nothing.
 * 5. The report of a confirmed / cancelled count: the same cards and charts; share or download.
 *
 * The rules do not change: a difference is never a sale by itself — only «اتباع ومتسجلش» is,
 * by the package's rule (الكاشير الذكي: a sale the count discovered, at the selling price, with
 * its cost and profit; إدارة المحل: its money is already in the day's totals). تالف / مفقود are
 * losses at cost, never revenue. The AI only explains: «اسأل حسبة» opens the assistant with a
 * question the owner sends himself; it never changes a count or the stock.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Icon, PageTitle, useToast } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import { failureMessage, formatBaseQty } from "@/client/shared/quantity";
import { shareReport, downloadFile } from "@/client/shared/share";
import { writeAiDraft } from "@/client/shared/ai-draft";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import { useAuth } from "@/client/shared/auth";
import { modeOf } from "../subscription/access";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import c$ from "@/client/shared/styles/Cards.module.css";
import styles from "./StocktakeView.module.css";
import { StocktakeCounter } from "./StocktakeCounter";
import { CountCharts } from "./StocktakeCharts";
import {
  REASON_LABEL,
  buildReportCsv,
  buildReportText,
  countMoneyEffects,
  reportFileName,
  scopeText,
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
  sections?: Array<{ category: string; products: number }>;
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

type Step = "home" | "section" | "count" | "summary" | "confirm" | "report";

/** The three steps, in a few words, on the stocktake's first screen. */
const HOW_STEPS = [
  "عدّ اللي موجود قدامك",
  "قارن الكمية باللي عند حِسبة",
  "راجع الفرق وأكّد الجرد",
] as const;

type HistoryFilter = "all" | "confirmed" | "abandoned";

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

/** «−3» / «+1 ك», kept left-to-right inside the Arabic text. */
const signed = (unit: string, d: number) => (
  <bdi dir="ltr">
    {d > 0 ? "+" : "−"}
    {formatBaseQty(unit, Math.abs(d))}
  </bdi>
);

/** The result of a count: cards, the differences, the money effect, the charts. */
function CountResult({ count }: { count: Count }) {
  const t = count.totals;
  const short = count.lines.filter(
    (l) => l.differenceBase !== null && l.differenceBase < 0,
  );
  const over = count.lines.filter(
    (l) => l.differenceBase !== null && l.differenceBase > 0,
  );
  const fx = countMoneyEffects(count);
  return (
    <>
      <div className={styles.resultCards} data-testid="stocktake-summary">
        <div className={`${c$.card} ${c$.lead}`}>
          <b className={c$.big} data-testid="stocktake-counted">
            {t.counted}
          </b>
          <span className={c$.label}>صنف اتعدّ</span>
        </div>
        <div
          className={`${c$.card} ${t.discrepancies ? c$.toneLow : c$.toneOk}`}
        >
          <b className={c$.big} data-testid="stocktake-diffs">
            {t.discrepancies}
          </b>
          <span className={c$.label}>فيه فرق</span>
        </div>
        <div className={`${c$.card} ${short.length ? c$.toneOut : ""}`}>
          <b className={c$.big} data-testid="stocktake-short">
            {short.length}
          </b>
          <span className={c$.label}>ناقص</span>
        </div>
        <div className={`${c$.card} ${over.length ? c$.toneInfo : ""}`}>
          <b className={c$.big} data-testid="stocktake-over">
            {over.length}
          </b>
          <span className={c$.label}>زيادة</span>
        </div>
      </div>
      {t.counted < t.lines && (
        <p className={styles.muted}>
          {t.lines - t.counted} صنف ما اتعدّش: مش هيتغير.
        </p>
      )}

      {short.length > 0 && (
        <section className={styles.diffCard} data-testid="stocktake-shortages">
          <h3 className={styles.h3}>النقص</h3>
          {short.map((l) => (
            <p key={l.variantId} className={styles.diffRow}>
              <span>
                {l.productName}
                <small>
                  {l.reason ? REASON_LABEL[l.reason] : "من غير سبب"}
                  {l.note ? ` · ${l.note}` : ""}
                </small>
              </span>
              <b className={styles.neg}>{signed(l.unit, l.differenceBase!)}</b>
            </p>
          ))}
        </section>
      )}
      {over.length > 0 && (
        <section className={styles.diffCard} data-testid="stocktake-surpluses">
          <h3 className={styles.h3}>الزيادة</h3>
          {over.map((l) => (
            <p key={l.variantId} className={styles.diffRow}>
              <span>
                {l.productName}
                {l.note ? <small>{l.note}</small> : null}
              </span>
              <b className={styles.pos}>{signed(l.unit, l.differenceBase!)}</b>
            </p>
          ))}
        </section>
      )}
      {short.length === 0 && over.length === 0 && t.counted > 0 && (
        <p className={styles.ok}>✓ مفيش فروق</p>
      )}

      {(fx.unrecordedSalePiasters > 0 ||
        fx.lossPiasters > 0 ||
        t.unrecordedSaleBase > 0) && (
        <section
          className={styles.diffCard}
          data-testid="stocktake-money-effect"
        >
          <h3 className={styles.h3}>التأثير</h3>
          {fx.unrecordedSalePiasters > 0 && (
            <p className={styles.diffRow}>
              <span>
                مبيعات ماتسجلتش
                <small>تتحسب بيع ومكسب لما تأكّد</small>
              </span>
              <b>{formatMoney(fx.unrecordedSalePiasters)}</b>
            </p>
          )}
          {count.salesMode === "simple" && t.unrecordedSaleBase > 0 && (
            <p className={styles.diffRow}>
              <span>
                اتباع ومتسجلش
                <small>فلوسه في مبيعات اليوم: من المخزون بس</small>
              </span>
              <b>—</b>
            </p>
          )}
          {fx.lossPiasters > 0 && (
            <p className={styles.diffRow}>
              <span>
                خسائر تالف ومفقود
                <small>بسعر الشراء · مش مبيعات</small>
              </span>
              <b className={styles.neg}>{formatMoney(fx.lossPiasters)}</b>
            </p>
          )}
          {fx.lossUnknownLines > 0 && (
            <p className={styles.muted}>
              {fx.lossUnknownLines} صنف تكلفته مش معروفة: مش محسوب.
            </p>
          )}
        </section>
      )}

      <CountCharts lines={count.lines} />
    </>
  );
}

export function StocktakeView({
  onNavigate,
}: { onNavigate?: (route: NavRoute) => void } = {}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("home");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [count, setCount] = useState<Count | null>(null);
  const [openCount, setOpenCount] = useState<{
    id: string;
    title: string;
    salesMode: "simple" | "pos";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");

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

  /** The whole count: for the summary and the report (once, not per product). */
  const loadCount = useCallback(async (id: string, then: Step) => {
    setError(null);
    const r = await fetch(`/api/inventory-counts/${id}`, {
      credentials: "same-origin",
    });
    if (!r.ok) return setError(await errorText(r, "مقدرناش نفتح الجرد"));
    const c = ((await r.json()) as { count: Count }).count;
    setCount(c);
    setStep(c.status === "open" ? then : "report");
  }, []);

  // An open count follows the shop's package now (what «اتباع ومتسجلش» means).
  const { session } = useAuth();
  const shopMode: "simple" | "pos" =
    modeOf(session ?? null, session?.store?.id ?? null) === "pos"
      ? "pos"
      : "simple";
  const resume = (h: Overview["history"][number]) => {
    setOpenCount({ id: h.id, title: scopeText(h), salesMode: shopMode });
    setStep("count");
  };

  const start = async (scope: "full" | "category", category?: string) => {
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
        }),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نبدأ الجرد"));
      const c = ((await res.json()) as { count: Count }).count;
      setOpenCount({
        id: c.id,
        title: scopeText(c),
        salesMode: c.salesMode ?? shopMode,
      });
      setStep("count");
      loadOverview();
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نبدأ الجرد"));
    } finally {
      setBusy(false);
    }
  };

  /** «اعمل جرد جديد»: while a count is still open, that one is cancelled first (no change). */
  const startNew = async () => {
    if (!overview?.open) return setStep("section");
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
    setStep("section");
  };

  const abandon = async (id: string) => {
    if (!window.confirm("تلغي الجرد ده؟ مفيش أي حاجة هتتغير في المخزون."))
      return;
    const res = await fetch(`/api/inventory-counts/${id}/abandon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) return setError(await errorText(res, "مقدرناش نلغي"));
    setCount(null);
    setOpenCount(null);
    loadOverview();
    setStep("home");
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
      setOpenCount(null);
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

  // ── 1. «الجرد» ──
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
      <div
        className={`${viewStyles.view} ${c$.pageStocktake}`}
        data-testid="page-stocktake"
      >
        <div className={styles.wrap}>
          <PageTitle>عدّ بضاعتك واعرف الناقص</PageTitle>
          <ol className={styles.how} data-testid="stocktake-how">
            {HOW_STEPS.map((s, i) => (
              <li key={s}>
                <span className={styles.howNum} aria-hidden="true">
                  {["١", "٢", "٣"][i]}
                </span>
                {s}
              </li>
            ))}
          </ol>
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
          {overview?.open && openRow && (
            <div className={styles.card} data-testid="stocktake-resume">
              <b>عندك جرد لسه مخلصش</b>
              <p className={styles.muted}>
                {`${scopeText(openRow)} · اتعدّ ${openRow.counted} من ${openRow.lines} · بدأ ${day(openRow.startedAt)}`}
              </p>
              <button
                type="button"
                className={styles.primary}
                onClick={() => resume(openRow)}
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
            💬 محتاج مساعدة؟ اسأل حسبة
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
                    onClick={() => void loadCount(h.id, "report")}
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

  // ── 2. «اختار قسم» ──
  if (step === "section") {
    const sections = overview?.sections ?? [];
    const all = sections.reduce((n, s) => n + s.products, 0);
    return (
      <div
        className={`${viewStyles.view} ${c$.pageStocktake}`}
        data-testid="page-stocktake"
      >
        <div className={styles.wrap}>
          <div className={styles.stepHead}>
            {stepBack("home")}
            <h2 className={styles.h2}>اختار القسم</h2>
          </div>
          {errorBox}
          {!overview && !error && <p className={styles.muted}>بنحمّل…</p>}
          {overview && sections.length === 0 && (
            <p className={styles.muted}>مفيش منتجات تتجرد لسه.</p>
          )}
          <div className={styles.sectionGrid} data-testid="stocktake-sections">
            {sections.map((s) => (
              <button
                key={s.category}
                type="button"
                className={styles.sectionBtn}
                disabled={busy}
                onClick={() => void start("category", s.category)}
                data-testid="stocktake-category"
              >
                <b>{s.category}</b>
                <small>{s.products} صنف</small>
              </button>
            ))}
          </div>
          {sections.length > 1 && (
            <button
              type="button"
              className={styles.ghost}
              disabled={busy}
              onClick={() => void start("full")}
              data-testid="stocktake-start-full"
            >
              🏪 كل المحل ({all} صنف)
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── 3. Counting ──
  if (step === "count" && openCount) {
    return (
      <div
        className={`${viewStyles.view} ${c$.pageStocktake}`}
        data-testid="page-stocktake"
      >
        {errorBox}
        <StocktakeCounter
          countId={openCount.id}
          title={openCount.title}
          salesMode={openCount.salesMode}
          onFinish={() => void loadCount(openCount.id, "summary")}
          onAbandon={() => void abandon(openCount.id)}
        />
      </div>
    );
  }

  if (!count) return null;

  // ── 4. «نتيجة الجرد», then the confirmation ──
  if (step === "summary" || step === "confirm") {
    return (
      <div
        className={`${viewStyles.view} ${c$.pageStocktake}`}
        data-testid="page-stocktake"
      >
        <div className={styles.wrap}>
          <h2 className={styles.h2}>ملخص الجرد</h2>
          <p className={styles.muted}>{scopeText(count)} · لسه ما اتأكّدش</p>
          <CountResult count={count} />
          {errorBox}
          {step === "confirm" ? (
            <div
              className={styles.confirm}
              role="alertdialog"
              data-testid="stocktake-confirm-box"
            >
              <p>
                <b>هتعدّل كميات المخزون بالفروق دي.</b>
              </p>
              <p>بعد التأكيد مش هتقدر تعدّل الجرد ده.</p>
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
                onClick={() => setStep("summary")}
                data-testid="stocktake-confirm-cancel"
              >
                رجوع
              </button>
            </div>
          ) : (
            <div className={styles.stickyBar}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy || count.totals.counted === 0}
                onClick={() => setStep("confirm")}
                data-testid="stocktake-apply"
              >
                أكّد الجرد
              </button>
              <div className={styles.twoBtns}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    setOpenCount({
                      id: count.id,
                      title: scopeText(count),
                      salesMode: count.salesMode ?? "pos",
                    });
                    setStep("count");
                  }}
                  data-testid="stocktake-back-to-count"
                >
                  كمّل العدّ
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => void abandon(count.id)}
                  data-testid="stocktake-abandon"
                >
                  إلغاء الجرد
                </button>
              </div>
              {count.totals.discrepancies > 0 && (
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

  // ── 5. The report (a confirmed or cancelled count) ──
  return (
    <div
      className={`${viewStyles.view} ${c$.pageStocktake}`}
      data-testid="page-stocktake"
    >
      <div className={styles.wrap} data-testid="stocktake-report">
        <h2 className={styles.h2}>تقرير الجرد</h2>
        <p className={styles.muted}>
          {scopeText(count)} ·{" "}
          {day(count.confirmedAt ?? count.abandonedAt ?? count.startedAt)}
          {count.closedBy
            ? ` · ${count.status === "confirmed" ? "طبّقه" : "لغاه"} ${count.closedBy}`
            : ""}
        </p>
        <p className={count.status === "confirmed" ? styles.ok : styles.muted}>
          {count.status === "confirmed"
            ? "✅ اتطبّق على المخزون مرة واحدة"
            : "اتلغى: المخزون ما اتغيرش"}
        </p>
        <CountResult count={count} />
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
          onClick={() => askHesba("وريني نتيجة آخر جرد")}
          data-testid="stocktake-ask-report"
        >
          💬 اسأل حسبة عن الجرد ده
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
