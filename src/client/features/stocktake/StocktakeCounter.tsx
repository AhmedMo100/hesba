"use client";

/**
 * @file StocktakeCounter.tsx
 * @description Counting one section (ADR-0039): scan, or search, or pick — Hesba finds the
 * product, shows what it holds, the owner types what he counted, and the next scan follows.
 *
 * - **Barcode** (camera, a physical scanner, or typed): the product's line opens under the camera,
 *   decoding pauses; «حفظ» saves it and the camera reads the next one. A barcode that is the
 *   shop's but in another section says so; an unknown one says to search by name.
 * - **No barcode** (weighed goods, loose items): the search (by name, debounced) and the two
 *   lists «لسه» / «اتعدّ», a page at a time. The barcode only makes it faster.
 * - **The same product twice** opens the same line: «اتعدّ 17» and what is typed is added
 *   («الإجمالي: 20»), or replaced on request. One line per product; the total is what is saved.
 * - **Damage recorded before** and **expired stock** are shown as help only: they already left
 *   (or sit in) Hesba's stock, so the difference is never charged twice.
 * - **A shortage** asks why: اتباع ومتسجلش · تالف · مفقود · سبب آخر (written). Nothing is a sale
 *   unless the owner says so, and nothing changes the stock before the count is confirmed.
 *
 * Requests: one page of lines on open, one per scan / search (debounced) / save — never the
 * whole shop. Each save is a total (`PATCH …?view=brief`), so retrying it changes nothing.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { BarcodeScanSheet } from "@/client/shared/scanner/BarcodeScanSheet";
import { useToast } from "@/client/shared/ui";
import {
  failureMessage,
  formatBaseQty,
  qtyUnitWord,
} from "@/client/shared/quantity";
import {
  cleanBarcode,
  differenceOf,
  modeForScan,
  nextTotal,
  typedBase,
  type CountMode,
} from "./stocktake-count.logic";
import type { CountReason } from "./stocktake-report";
import styles from "./StocktakeView.module.css";

export interface CounterLine {
  variantId: string;
  productName: string;
  category: string;
  unit: string;
  packQty: number;
  expectedBase: number;
  countedBase: number | null;
  differenceBase: number | null;
  reason: CountReason | null;
  note: string | null;
  barcode: string | null;
  wasteBefore: {
    quantityBase: number;
    records: Array<{
      quantityBase: number;
      reasonLabel: string;
      at: string;
    }>;
  } | null;
  expiredBase: number;
}

interface LinesPage {
  lines: CounterLine[];
  next: number | null;
  counted: number;
  total: number;
  elsewhere: { name: string; category: string } | null;
}

/** «السبب؟» — four plain choices (owner, 2026-11-26). */
const SHORTAGE_CHOICES: Array<[CountReason, string]> = [
  ["unrecorded_sale", "اتباع ومتسجلش"],
  ["damaged", "تالف"],
  ["lost", "مفقود"],
  ["unknown", "سبب آخر"],
];
const EXPIRED_CHOICE: [CountReason, string] = ["expired", "منتهي الصلاحية"];
const SURPLUS_CHOICES = [
  "بضاعة دخلت ومتسجلتش",
  "مرتجع من زبون",
  "كانت متسجلة أقل من الحقيقة",
] as const;
const SURPLUS_OTHER = "سبب آخر";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
  });

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

/** One product being counted: what Hesba holds, what was counted, the difference, why. */
function LinePanel({
  line,
  initialMode,
  salesMode,
  busy,
  onSave,
  onCancel,
}: {
  line: CounterLine;
  initialMode: CountMode;
  salesMode: "simple" | "pos";
  busy: boolean;
  onSave: (body: {
    countedBase: number;
    reason: CountReason | null;
    note: string | null;
  }) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<CountMode>(initialMode);
  const [loose, setLoose] = useState("");
  const [cartons, setCartons] = useState("");
  const [reason, setReason] = useState<CountReason | null>(
    line.reason && line.reason !== "surplus" ? line.reason : null,
  );
  const saved = line.note ?? "";
  const presetSurplus =
    line.reason === "surplus" &&
    (SURPLUS_CHOICES as readonly string[]).includes(saved);
  const [surplusWhy, setSurplusWhy] = useState<string | null>(
    line.reason === "surplus" && saved
      ? presetSurplus
        ? saved
        : SURPLUS_OTHER
      : null,
  );
  const [note, setNote] = useState(presetSurplus ? "" : saved);
  const [err, setErr] = useState<string | null>(null);
  const [showWaste, setShowWaste] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [line.variantId]);

  const typed = typedBase(line.unit, line.packQty, loose, cartons);
  const total = nextTotal(line.countedBase, typed, mode);
  const diff = differenceOf(total, line.expectedBase);
  const unitWord = qtyUnitWord(line.unit);

  const submit = () => {
    setErr(null);
    if (total === null) {
      return setErr(
        loose.trim() || cartons.trim()
          ? `اكتب الكمية صح (${unitWord})`
          : "اكتب إنت عدّيت كام",
      );
    }
    if (diff !== null && diff < 0 && !reason) return setErr("اختار السبب");
    if (diff !== null && diff < 0 && reason === "unknown" && !note.trim())
      return setErr("اكتب السبب");
    if (diff !== null && diff > 0 && !surplusWhy)
      return setErr("اختار الزيادة جت منين");
    const lineNote =
      diff === null || diff === 0
        ? null
        : diff > 0
          ? surplusWhy === SURPLUS_OTHER
            ? note.trim() || null
            : surplusWhy
          : note.trim() || null;
    if (diff !== null && diff > 0 && surplusWhy === SURPLUS_OTHER && !lineNote)
      return setErr("اكتب الزيادة جت منين");
    onSave({
      countedBase: total,
      reason: diff !== null && diff < 0 ? reason : null,
      note: lineNote,
    });
  };

  return (
    <div className={styles.linePanel} data-testid="stocktake-line">
      <h2 className={styles.product}>{line.productName}</h2>
      <p className={styles.expected} data-testid="stocktake-expected">
        الموجود في حِسبة: <b>{formatBaseQty(line.unit, line.expectedBase)}</b>{" "}
        {unitWord}
      </p>
      {line.countedBase !== null && (
        <div className={styles.already} data-testid="stocktake-already">
          <span>
            اتعدّ قبل كده: <b>{formatBaseQty(line.unit, line.countedBase)}</b>
          </span>
          <div className={styles.modeSwitch} role="radiogroup">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "add"}
              className={mode === "add" ? styles.modeOn : ""}
              onClick={() => setMode("add")}
              data-testid="stocktake-mode-add"
            >
              زوّد عليه
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "replace"}
              className={mode === "replace" ? styles.modeOn : ""}
              onClick={() => setMode("replace")}
              data-testid="stocktake-mode-replace"
            >
              اكتب من الأول
            </button>
          </div>
        </div>
      )}
      {(line.wasteBefore || line.expiredBase > 0) && (
        <div className={styles.helpBox} data-testid="stocktake-help">
          {line.wasteBefore && (
            <button
              type="button"
              className={styles.helpLine}
              onClick={() => setShowWaste((v) => !v)}
              aria-expanded={showWaste}
              data-testid="stocktake-waste-before"
            >
              تالف متسجّل قبل كده:{" "}
              <b>{formatBaseQty(line.unit, line.wasteBefore.quantityBase)}</b>{" "}
              <small>(متخصم من حِسبة خلاص)</small>
            </button>
          )}
          {showWaste &&
            line.wasteBefore?.records.map((r) => (
              <small key={r.at} className={styles.helpRecord}>
                {formatBaseQty(line.unit, r.quantityBase)} · {r.reasonLabel} ·{" "}
                {day(r.at)}
              </small>
            ))}
          {line.expiredBase > 0 && (
            <p className={styles.helpLine} data-testid="stocktake-expired-info">
              منه منتهي الصلاحية:{" "}
              <b>{formatBaseQty(line.unit, line.expiredBase)}</b>
            </p>
          )}
        </div>
      )}

      <label className={styles.lbl} htmlFor="st-actual">
        {mode === "add" && line.countedBase !== null
          ? `زوّد كام (${unitWord})؟`
          : `إنت عدّيت (${unitWord}):`}
      </label>
      <div className={styles.countInputs}>
        <input
          id="st-actual"
          ref={inputRef}
          className={styles.bigInput}
          inputMode="decimal"
          placeholder="0"
          value={loose}
          onChange={(e) => {
            setLoose(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          aria-label={`العدد (${unitWord})`}
          data-testid="stocktake-count"
        />
        {line.packQty > 1 && (
          <label className={styles.cartonBox}>
            <input
              className={styles.cartonInput}
              inputMode="numeric"
              placeholder="0"
              value={cartons}
              onChange={(e) => {
                setCartons(e.target.value);
                setErr(null);
              }}
              data-testid="stocktake-cartons"
            />
            <small>كرتونة × {line.packQty}</small>
          </label>
        )}
      </div>
      {mode === "add" && line.countedBase !== null && total !== null && (
        <p className={styles.totalLine} data-testid="stocktake-total">
          الإجمالي: <b>{formatBaseQty(line.unit, total)}</b>
        </p>
      )}

      {diff !== null && diff !== 0 && (
        <div className={styles.diffBox} data-testid="stocktake-diff">
          <p
            className={`${styles.diffLine} ${diff < 0 ? styles.neg : styles.pos}`}
          >
            {diff < 0 ? "فرق: " : "زيادة: "}
            <bdi dir="ltr">
              <b>
                {diff < 0 ? "−" : "+"}
                {formatBaseQty(line.unit, Math.abs(diff))}
              </b>
            </bdi>{" "}
            {unitWord}
          </p>
          {diff < 0 ? (
            <>
              <p className={styles.why} data-testid="stocktake-why">
                السبب؟
              </p>
              <div className={styles.reasons}>
                {(reason === "expired"
                  ? [...SHORTAGE_CHOICES, EXPIRED_CHOICE]
                  : SHORTAGE_CHOICES
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`${styles.reason} ${reason === k ? styles.reasonOn : ""}`}
                    aria-pressed={reason === k}
                    onClick={() => {
                      setReason(k);
                      setErr(null);
                    }}
                    data-testid={`stocktake-reason-${k}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {reason && reason !== "unrecorded_sale" && (
                <input
                  className={styles.noteInput}
                  dir="auto"
                  maxLength={300}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    reason === "unknown" ? "اكتب السبب" : "ملاحظة (لو حابب)"
                  }
                  aria-label="السبب"
                  data-testid="stocktake-note"
                />
              )}
              {reason === "unrecorded_sale" && (
                <p className={styles.muted} data-testid="stocktake-sold-effect">
                  {salesMode === "simple"
                    ? "فلوسه في مبيعات اليوم: هيتخصم من المخزون بس."
                    : "هيتحسب بيع بسعر البيع (ومكسبه) لما تأكّد الجرد."}
                </p>
              )}
              {(reason === "damaged" || reason === "lost") && (
                <p className={styles.muted}>خسارة بسعر الشراء، مش مبيعات.</p>
              )}
            </>
          ) : (
            <>
              <p className={styles.why} data-testid="stocktake-why">
                جت منين؟
              </p>
              <div className={styles.reasons}>
                {[...SURPLUS_CHOICES, SURPLUS_OTHER].map((k, i) => (
                  <button
                    key={k}
                    type="button"
                    className={`${styles.reason} ${surplusWhy === k ? styles.reasonOn : ""}`}
                    aria-pressed={surplusWhy === k}
                    onClick={() => {
                      setSurplusWhy(k);
                      setErr(null);
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
            </>
          )}
        </div>
      )}
      {diff === 0 && <p className={styles.ok}>✓ مظبوط</p>}
      {err && (
        <p className={styles.error} role="alert" data-testid="stocktake-error">
          {err}
        </p>
      )}
      <div className={styles.twoBtns}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy}
          onClick={submit}
          data-testid="stocktake-save"
        >
          {busy ? "بيتحفظ…" : "حفظ ✓"}
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={busy}
          onClick={onCancel}
          data-testid="stocktake-line-cancel"
        >
          رجوع
        </button>
      </div>
    </div>
  );
}

export function StocktakeCounter({
  countId,
  title,
  salesMode,
  onFinish,
  onAbandon,
}: {
  countId: string;
  title: string;
  salesMode: "simple" | "pos";
  /** «خلصت العدّ»: to the summary. */
  onFinish: () => void;
  onAbandon: () => void;
}) {
  const toast = useToast();
  const [progress, setProgress] = useState({ counted: 0, total: 0 });
  const [tab, setTab] = useState<"pending" | "counted">("pending");
  const [lists, setLists] = useState<
    Record<
      "pending" | "counted",
      { lines: CounterLine[]; next: number | null } | null
    >
  >({ pending: null, counted: null });
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{
    line: CounterLine;
    mode: CountMode;
  } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/inventory-counts/${countId}`;

  const fetchPage = useCallback(
    async (params: Record<string, string>): Promise<LinesPage> => {
      const r = await fetch(`${base}/lines?${new URLSearchParams(params)}`, {
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error(await errorText(r, "مقدرناش نجيب الأصناف"));
      return (await r.json()) as LinesPage;
    },
    [base],
  );

  const applyPage = useCallback(
    (which: "pending" | "counted", cursor: number, p: LinesPage) => {
      setProgress({ counted: p.counted, total: p.total });
      setLists((prev) => ({
        ...prev,
        [which]: {
          lines:
            cursor === 0
              ? p.lines
              : [...(prev[which]?.lines ?? []), ...p.lines],
          next: p.next,
        },
      }));
      setError(null);
    },
    [],
  );
  const loadList = useCallback(
    (which: "pending" | "counted", cursor = 0) =>
      fetchPage({ status: which, cursor: String(cursor), limit: "30" })
        .then((p) => applyPage(which, cursor, p))
        .catch((e: unknown) =>
          setError(failureMessage(e, "مقدرناش نجيب الأصناف")),
        ),
    [fetchPage, applyPage],
  );
  useEffect(() => {
    void loadList("pending");
  }, [loadList]);
  const showTab = (k: "pending" | "counted") => {
    setTab(k);
    if (k === "counted" && !lists.counted) void loadList("counted");
  };

  // The search: by name, a moment after typing stops (one request, not one per letter).
  const term = q.trim();
  const [search, setSearch] = useState<{
    term: string;
    lines: CounterLine[];
  } | null>(null);
  useEffect(() => {
    if (!term) return;
    let live = true;
    const t = setTimeout(() => {
      fetchPage({ q: term, limit: "20" })
        .then((p) => live && setSearch({ term, lines: p.lines }))
        .catch(() => live && setSearch({ term, lines: [] }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [term, fetchPage]);
  const results: CounterLine[] | null = !term
    ? null
    : search?.term === term
      ? search.lines
      : [];
  const searching = Boolean(term) && search?.term !== term;

  // One scan at a time: a code read while the last one is still being looked up is ignored.
  const looking = useRef(false);
  const onCode = useCallback(
    async (raw: string) => {
      const code = cleanBarcode(raw);
      if (!code || looking.current) return;
      looking.current = true;
      setScanMsg(null);
      try {
        const p = await fetchPage({ barcode: code, limit: "5" });
        const line = p.lines[0];
        if (line) {
          setOpen({ line, mode: modeForScan(line.countedBase) });
        } else if (p.elsewhere) {
          setScanMsg(
            `«${p.elsewhere.name}» في قسم «${p.elsewhere.category}»، مش في الجرد ده.`,
          );
        } else {
          setScanMsg("الباركود ده مش متسجل. دوّر على المنتج باسمه.");
        }
      } catch (e: unknown) {
        setScanMsg(failureMessage(e, "مقدرناش ندوّر"));
      } finally {
        looking.current = false;
      }
    },
    [fetchPage],
  );

  const save = async (
    line: CounterLine,
    body: {
      countedBase: number;
      reason: CountReason | null;
      note: string | null;
    },
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}?view=brief`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: [{ variantId: line.variantId, ...body }],
        }),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نحفظ"));
      const p = (await res.json()) as LinesPage;
      const updated = p.lines[0];
      setProgress({ counted: p.counted, total: p.total });
      if (updated) {
        setLists((prev) => ({
          pending: prev.pending && {
            ...prev.pending,
            lines: prev.pending.lines.filter(
              (l) => l.variantId !== updated.variantId,
            ),
          },
          counted: prev.counted && {
            ...prev.counted,
            lines: [
              updated,
              ...prev.counted.lines.filter(
                (l) => l.variantId !== updated.variantId,
              ),
            ],
          },
        }));
        setSearch((r) =>
          r
            ? {
                ...r,
                lines: r.lines.map((l) =>
                  l.variantId === updated.variantId ? updated : l,
                ),
              }
            : r,
        );
      }
      setOpen(null);
      toast.show({
        msg: `${line.productName}: ${formatBaseQty(line.unit, body.countedBase)} ✓`,
        kind: "ok",
      });
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نحفظ"));
    } finally {
      setBusy(false);
    }
  };

  const pct = progress.total ? (progress.counted / progress.total) * 100 : 0;
  const list = results ?? lists[tab]?.lines ?? null;
  const panel = open && (
    <LinePanel
      key={`${open.line.variantId}:${open.line.countedBase}`}
      line={open.line}
      initialMode={open.mode}
      salesMode={salesMode}
      busy={busy}
      onSave={(b) => void save(open.line, b)}
      onCancel={() => setOpen(null)}
    />
  );
  const rows = useMemo(
    () =>
      (list ?? []).map((l) => (
        <button
          key={l.variantId}
          type="button"
          className={styles.row}
          onClick={() => setOpen({ line: l, mode: modeForScan(l.countedBase) })}
          data-testid="stocktake-pick-line"
        >
          <span>
            <b>{l.productName}</b>
            <small>
              في حِسبة {formatBaseQty(l.unit, l.expectedBase)}
              {l.countedBase !== null
                ? ` · اتعدّ ${formatBaseQty(l.unit, l.countedBase)}`
                : ""}
              {l.barcode ? "" : " · من غير باركود"}
            </small>
          </span>
          {l.differenceBase !== null && l.differenceBase !== 0 ? (
            <b className={l.differenceBase < 0 ? styles.neg : styles.pos}>
              <bdi dir="ltr">
                {l.differenceBase < 0 ? "−" : "+"}
                {formatBaseQty(l.unit, Math.abs(l.differenceBase))}
              </bdi>
            </b>
          ) : l.countedBase !== null ? (
            <b className={styles.okMark}>✓</b>
          ) : (
            <small className={styles.muted}>عدّ ←</small>
          )}
        </button>
      )),
    [list],
  );

  return (
    <div className={styles.wrap} data-testid="stocktake-counter">
      <div className={styles.progressHead}>
        <b>{title}</b>
        <span data-testid="stocktake-progress">
          {progress.total > 0
            ? `اتعدّ ${progress.counted} من ${progress.total}`
            : "…"}
        </span>
      </div>
      <div className={styles.progress}>
        <span style={{ width: `${pct}%` }} />
      </div>

      {!scanning && open ? (
        panel
      ) : (
        <>
          <button
            type="button"
            className={styles.scanBtn}
            onClick={() => {
              setScanMsg(null);
              setScanning(true);
            }}
            data-testid="stocktake-scan"
          >
            📷 امسح الباركود
          </button>
          <input
            type="search"
            className={styles.input}
            placeholder="أو دوّر بالاسم…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            dir="auto"
            data-testid="stocktake-search"
          />
          {!results && (
            <div className={styles.filter} role="tablist">
              {(
                [
                  [
                    "pending",
                    `لسه (${Math.max(0, progress.total - progress.counted)})`,
                  ],
                  ["counted", `اتعدّ (${progress.counted})`],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  className={`${styles.filterChip} ${tab === k ? styles.filterOn : ""}`}
                  onClick={() => showTab(k)}
                  data-testid={`stocktake-tab-${k}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p
              className={styles.error}
              role="alert"
              data-testid="stocktake-error"
            >
              {error}
            </p>
          )}
          {list === null || searching ? (
            <p className={styles.muted}>بنحمّل…</p>
          ) : list.length === 0 ? (
            <p className={styles.muted}>
              {results
                ? "مفيش منتج بالاسم ده في الجرد ده."
                : tab === "pending"
                  ? "✓ كله اتعدّ"
                  : "لسه ما عدّيتش حاجة."}
            </p>
          ) : (
            <div
              className={styles.list}
              data-testid={`stocktake-list-${results ? "search" : tab}`}
            >
              {rows}
            </div>
          )}
          {!results && lists[tab]?.next != null && (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => void loadList(tab, lists[tab]!.next!)}
              data-testid="stocktake-more"
            >
              عرض أكتر
            </button>
          )}
          <div className={styles.stickyBar}>
            <button
              type="button"
              className={styles.primary}
              disabled={progress.counted === 0}
              onClick={onFinish}
              data-testid="stocktake-to-summary"
            >
              خلصت العدّ ← الملخص
            </button>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={onAbandon}
              data-testid="stocktake-abandon"
            >
              إلغاء الجرد
            </button>
          </div>
        </>
      )}

      {scanning && (
        <BarcodeScanSheet
          title="📷 جرد بالباركود"
          paused={Boolean(open)}
          onCode={(c) => void onCode(c)}
          onClose={() => {
            setScanning(false);
            setOpen(null);
          }}
        >
          {open ? (
            panel
          ) : scanMsg ? (
            <p
              className={styles.scanMsg}
              role="status"
              data-testid="stocktake-scan-msg"
            >
              {scanMsg}
            </p>
          ) : null}
        </BarcodeScanSheet>
      )}
    </div>
  );
}
