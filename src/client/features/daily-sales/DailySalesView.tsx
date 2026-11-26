"use client";

/**
 * @file DailySalesView.tsx
 * @description «مبيعات اليوم» for إدارة المحل (ADR-0033): the day's sales as one total, split by how
 * it was paid — cash (counted in the drawer), each machine / wallet of the shop (its balance goes
 * up), and credit (آجل) to named customers (a «ليك» debt each; collecting it later is never a
 * second sale). Optionally the quantities of some products the owner knows he sold: they take
 * stock out but add no money (it is already in the total). Without quantities no stock moves —
 * a stock difference is found at the stocktake. Today's entries can be cancelled; they stay on
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
import { apiGet } from "@/client/shared/api/read-cache";
import {
  formatBaseQty,
  qtyUnitWord,
  toBaseQty,
  variantOptions,
  type StoreVariantOption,
  failureMessage,
} from "@/client/shared/quantity";
import c$ from "@/client/shared/styles/Cards.module.css";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import { Seg } from "@/client/shared/ui";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import { ServiceOpsView } from "../services/ServiceOpsView";
import styles from "../expenses/ExpensesView.module.css";

interface DayList {
  entries: DailySalesEntryView[];
  totalPiasters: number;
  cashPiasters: number;
  walletPiasters: number;
  creditPiasters?: number;
}

interface Customer {
  id: string;
  name: string;
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

export function DailySalesView({
  onNavigate,
}: {
  onNavigate?: (route: NavRoute) => void;
} = {}) {
  const today = useMemo(() => toCairoDateString(new Date()), []);
  // «بيع حاجة» in إدارة المحل: the day's total, or a service done for a customer.
  const [tab, setTab] = useState<"day" | "service">("day");
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
  // Credit (آجل) rows: a customer and an amount each.
  const [credits, setCredits] = useState<
    Array<{ customerId: string; amount: string }>
  >([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Optional quantities sold.
  const [showItems, setShowItems] = useState(false);
  const [variants, setVariants] = useState<StoreVariantOption[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [items, setItems] = useState<
    Array<{ variant: StoreVariantOption; qty: string }>
  >([]);

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
      .catch((e: unknown) => setError(failureMessage(e, "مفيش نت")));
  }, [day]);
  useEffect(load, [load]);
  useEffect(() => {
    void fetchStoreMachines().then((l) =>
      setMachines(l.filter((m) => m.status !== "inactive")),
    );
  }, []);
  const loadCustomers = useCallback(() => {
    apiGet("/api/people?section=owedToMe")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { people?: Array<{ id: string; name: string }> } | null) =>
        setCustomers(
          (d?.people ?? []).map((p) => ({ id: p.id, name: p.name })),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (credits.length > 0 && customers.length === 0) loadCustomers();
  }, [credits.length, customers.length, loadCustomers]);
  useEffect(() => {
    if (!showItems || variants.length > 0) return;
    apiGet("/api/products?scope=store")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVariants(variantOptions(d)))
      .catch(() => {});
  }, [showItems, variants.length]);

  const cashP = toPiasters(cash);
  const partP = machines.map((m) => ({ m, p: toPiasters(parts[m.id] ?? "") }));
  const creditP = credits.map((c) => ({ ...c, p: toPiasters(c.amount) }));
  const itemQ = items.map((i) => ({
    ...i,
    q: toBaseQty(i.variant.unit, i.qty),
  }));
  const invalid =
    cashP === null ||
    partP.some((x) => x.p === null) ||
    creditP.some((c) => c.p === null || (c.p > 0 && !c.customerId));
  const creditTotal = creditP.reduce((s, c) => s + (c.p ?? 0), 0);
  const total =
    (cashP ?? 0) + partP.reduce((s, x) => s + (x.p ?? 0), 0) + creditTotal;
  const itemMatches = itemSearch.trim()
    ? variants
        .filter(
          (v) =>
            v.name.includes(itemSearch.trim()) &&
            !items.some((i) => i.variant.variantId === v.variantId),
        )
        .slice(0, 8)
    : [];

  const save = async () => {
    setFormError(null);
    if (invalid)
      return setFormError(
        "اكتب المبالغ بالجنيه صح، واختار الزبون لكل مبلغ آجل",
      );
    if (itemQ.some((i) => i.q === null))
      return setFormError("اكتب الكميات صح (الوزن بالكيلو)");
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
          credits: creditP
            .filter((c) => (c.p ?? 0) > 0)
            .map((c) => ({ customerId: c.customerId, amountPiasters: c.p })),
          items: itemQ
            .filter((i) => (i.q ?? 0) > 0)
            .map((i) => ({
              variantId: i.variant.variantId,
              quantityBase: i.q,
            })),
          note: note.trim() || null,
        }),
      });
      if (!res.ok)
        throw new Error(await errorText(res, "مقدرناش نسجّل مبيعات اليوم"));
      setOpId(crypto.randomUUID());
      setCash("");
      setParts({});
      setCredits([]);
      setItems([]);
      setShowItems(false);
      setNote("");
      load();
      void fetchStoreMachines().then((l) =>
        setMachines(l.filter((m) => m.status !== "inactive")),
      );
    } catch (e: unknown) {
      setFormError(failureMessage(e, "مقدرناش نسجّل مبيعات اليوم"));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (e: DailySalesEntryView) => {
    if (
      !window.confirm(
        `تلغي تسجيل ${formatMoney(e.totalPiasters)}؟ الكاش هيطلع من حساب الدرج، وفلوس المحافظ هترجع منها، والآجل هيتشال من على الزباين، والكميات هترجع للمخزون.`,
      )
    )
      return;
    const res = await fetch(`/api/daily-sales/${e.id}`, { method: "DELETE" });
    if (!res.ok) setError(await errorText(res, "مقدرناش نلغي"));
    load();
  };

  const tabs = (
    <Seg<"day" | "service">
      value={tab}
      onChange={setTab}
      options={[
        ["day", "🛒 بيع اليوم"],
        ["service", "📲 خدمة"],
      ]}
      ariaLabel="نوع البيع"
      className={styles.sellTabs}
    />
  );
  if (tab === "service")
    return (
      <div
        className={`${viewStyles.view} ${c$.pageSell}`}
        data-testid="page-daily-sales"
      >
        <div className={styles.container}>
          {tabs}
          <h2 className={styles.askTitle}>سجّل عملية خدمة</h2>
          <ServiceOpsView embedded onNavigate={onNavigate} />
        </div>
      </div>
    );

  return (
    <div
      className={`${viewStyles.view} ${c$.pageSell}`}
      data-testid="page-daily-sales"
    >
      <div className={styles.container}>
        {tabs}
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
          {/* آجل: sold on credit to named customers — revenue and a «ليك» debt, not cash */}
          {credits.map((c, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 8 }}
              data-testid="daily-credit-row"
            >
              <select
                className={styles.input}
                value={c.customerId}
                onChange={(ev) =>
                  setCredits((l) =>
                    l.map((x, k) =>
                      k === i ? { ...x, customerId: ev.target.value } : x,
                    ),
                  )
                }
                aria-label="الزبون"
                data-testid="daily-credit-customer"
              >
                <option value="">اختار الزبون…</option>
                {customers.map((cu) => (
                  <option key={cu.id} value={cu.id}>
                    {cu.name}
                  </option>
                ))}
              </select>
              <input
                className={styles.input}
                inputMode="decimal"
                placeholder="المبلغ"
                value={c.amount}
                onChange={(ev) =>
                  setCredits((l) =>
                    l.map((x, k) =>
                      k === i ? { ...x, amount: ev.target.value } : x,
                    ),
                  )
                }
                aria-label="مبلغ الآجل"
                data-testid="daily-credit-amount"
              />
              <button
                type="button"
                className={styles.undoBtn}
                onClick={() => setCredits((l) => l.filter((_, k) => k !== i))}
                aria-label="شيل"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={styles.undoBtn}
            onClick={() =>
              setCredits((l) => [...l, { customerId: "", amount: "" }])
            }
            data-testid="daily-add-credit"
          >
            ➕ بيع آجل لزبون
          </button>
          {credits.length > 0 && (
            <p
              className={styles.historyNote}
              style={{ textAlign: "start", margin: 0 }}
            >
              الآجل بيتحسب في مبيعات اليوم وبيتسجل على الزبون في «ليك». لما
              يدفع، سجّل الدفعة من حسابه — مش بيعة جديدة.
            </p>
          )}

          {/* Optional quantities: stock out, no extra money */}
          <button
            type="button"
            className={styles.undoBtn}
            onClick={() => setShowItems((v) => !v)}
            aria-expanded={showItems}
            data-testid="daily-toggle-items"
          >
            {showItems ? "➖ من غير كميات" : "📦 عارف كميات اتباعت؟ (اختياري)"}
          </button>
          {showItems && (
            <>
              <p
                className={styles.historyNote}
                style={{ textAlign: "start", margin: 0 }}
              >
                الكميات بتنقص المخزون بس — فلوسها محسوبة خلاص في المبالغ اللي
                فوق.
              </p>
              <input
                className={styles.input}
                dir="auto"
                placeholder="دوّر على صنف…"
                value={itemSearch}
                onChange={(ev) => setItemSearch(ev.target.value)}
                data-testid="daily-item-search"
              />
              {itemMatches.map((v) => (
                <button
                  key={v.variantId}
                  type="button"
                  className={styles.undoBtn}
                  style={{ textAlign: "start" }}
                  onClick={() => {
                    setItems((l) => [...l, { variant: v, qty: "" }]);
                    setItemSearch("");
                  }}
                  data-testid="daily-item-option"
                >
                  {v.name} · عندك {formatBaseQty(v.unit, v.stockBase)}
                </button>
              ))}
              {items.map((it, i) => (
                <div
                  key={it.variant.variantId}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
                >
                  <span style={{ flex: 1 }}>{it.variant.name}</span>
                  <input
                    className={styles.input}
                    style={{ maxWidth: 120 }}
                    inputMode="decimal"
                    placeholder={qtyUnitWord(it.variant.unit)}
                    value={it.qty}
                    onChange={(ev) =>
                      setItems((l) =>
                        l.map((x, k) =>
                          k === i ? { ...x, qty: ev.target.value } : x,
                        ),
                      )
                    }
                    aria-label={`كمية ${it.variant.name}`}
                    data-testid="daily-item-qty"
                  />
                  <button
                    type="button"
                    className={styles.undoBtn}
                    onClick={() => setItems((l) => l.filter((_, k) => k !== i))}
                    aria-label="شيل"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </>
          )}

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
                {list.creditPiasters
                  ? ` · آجل ${formatMoney(list.creditPiasters)}`
                  : ""}
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
                      {e.credits.map(
                        (c) =>
                          ` · 📝 ${c.customerName} ${formatMoney(c.amountPiasters)}`,
                      )}
                      {e.items.length > 0 ? ` · 📦 ${e.items.length} صنف` : ""}
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
          الإجمالي من غير كميات مش بيخصم من المخزون: أي فرق في البضاعة بيبان في
          الجرد كفرق جرد، ومش بيتحسب مبيعات إلا لو انت قلت كده.
        </p>
      </div>
    </div>
  );
}

export default DailySalesView;
