"use client";

/**
 * @file ServicesView.tsx
 * @description «الخدمات» (both modes): the owner records a service he already performed on the
 * provider's app / machine (Vodafone Cash, Fawry, Aman, recharge, bills, cards). Hesba has no
 * provider connection, so the screen never says the provider confirmed anything. The commission
 * comes from the shop's rule (same math as the server: `slabFor`), can be typed when it differs,
 * and is the only income — the operation's amount is never sales.
 *
 * It is also where the shop's machines / wallets and its cashier services are managed (tab
 * «المحافظ والماكينات»: add, top up, rename, delete; the services sold at the cashier with
 * their commission rules) — the same component the old stand-alone page used, unchanged.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, normDigits } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { toCairoDateString } from "@/domain/time";
import {
  SERVICE_BY_KEY,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  SERVICES,
  serviceMoney,
  type CommissionMode,
  type ServiceCategory,
} from "@/domain/services-catalog";
import {
  slabFor,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { failureMessage } from "@/client/shared/quantity";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";
import { AlertsView } from "../alerts/AlertsView";

interface ServiceRow {
  id: string;
  label: string;
  provider: string;
  direction: "send" | "receive";
  amountPiasters: number;
  commissionPiasters: number;
  customerPiasters: number;
  floatMachine: string;
  payment: string;
  status: "completed" | "cancelled";
  at: string;
}
interface ServicesAnswer {
  items: ServiceRow[];
  summary: {
    count: number;
    commissionPiasters: number;
    amountPiasters: number;
  };
  rules: Record<string, { mode: CommissionMode; rule: ServiceCommissionRule }>;
}

const egp = (v: string) => {
  const t = normDigits(v).trim();
  return t ? parseEgpStrict(t) : null;
};

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

type Tab = "record" | "machines";

export function ServicesView({
  initialTab = "record",
}: { initialTab?: Tab } = {}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const today = useMemo(() => toCairoDateString(new Date()), []);
  const [data, setData] = useState<ServicesAnswer | null>(null);
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [category, setCategory] = useState<ServiceCategory>("wallet");
  const [key, setKey] = useState("wallet_deposit");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [floatId, setFloatId] = useState("");
  const [payment, setPayment] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  // Rule editor for the chosen service.
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleType, setRuleType] = useState<"fixed" | "percent">("fixed");
  const [ruleValue, setRuleValue] = useState("");
  const [ruleMode, setRuleMode] = useState<CommissionMode>("customer_fee");

  const load = useCallback(() => {
    fetch(`/api/services?from=${today}&to=${today}`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorText(r, "مقدرناش نجيب الخدمات"));
        return (await r.json()) as ServicesAnswer;
      })
      .then(setData)
      .catch((e: unknown) => setError(failureMessage(e, "مفيش نت")));
  }, [today]);
  useEffect(load, [load]);
  // Re-read the machines whenever the record tab shows (a machine may have been added or
  // topped up in the other tab).
  useEffect(() => {
    if (tab !== "record") return;
    void fetchStoreMachines().then((l) => {
      const active = l.filter((m) => m.status !== "inactive");
      setMachines(active);
      setFloatId((cur) =>
        cur && active.some((m) => m.id === cur) ? cur : active[0]?.id || "",
      );
    });
  }, [tab]);

  const def = SERVICE_BY_KEY.get(key)!;
  const rule = data?.rules[key];
  const mode: CommissionMode = rule?.mode ?? def.defaultMode;
  const amountP = egp(amount);
  const typed = commission.trim() ? egp(commission) : undefined;
  const fromRule =
    amountP && amountP > 0
      ? rule
        ? slabFor(rule.rule, amountP)?.piasters
        : 0
      : undefined;
  const commissionP = typed !== undefined ? typed : fromRule;
  let money: ReturnType<typeof serviceMoney> | null = null;
  try {
    if (
      amountP &&
      amountP > 0 &&
      commissionP !== null &&
      commissionP !== undefined
    )
      money = serviceMoney(def.direction, mode, amountP, commissionP);
  } catch {
    money = null;
  }

  const pickCategory = (c: ServiceCategory) => {
    setCategory(c);
    const first = SERVICES.find((s) => s.category === c)!;
    setKey(first.key);
    setProvider(first.providers[0] ?? "");
    setCommission("");
  };

  const save = async () => {
    setError(null);
    if (!amountP || amountP <= 0) return setError("اكتب مبلغ العملية");
    if (!floatId)
      return setError("ضيف المحفظة أو الماكينة اللي بتعمل منها الخدمة الأول");
    if (!provider.trim()) return setError("اكتب اسم الشركة");
    if (!money) return setError("العمولة مش مظبوطة للمبلغ ده");
    setBusy(true);
    try {
      const res = await fetch("/api/services/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opId,
          serviceKey: key,
          provider: provider.trim(),
          amountPiasters: amountP,
          floatMachineId: floatId,
          payment: payment === "cash" ? "cash" : { machineId: payment },
          ...(typed !== undefined && typed !== null
            ? { commissionPiasters: typed }
            : {}),
          reference: reference.trim() || null,
        }),
      });
      if (!res.ok)
        throw new Error(await errorText(res, "مقدرناش نسجّل الخدمة"));
      setOpId(crypto.randomUUID());
      setAmount("");
      setCommission("");
      setReference("");
      load();
      void fetchStoreMachines().then((l) =>
        setMachines(l.filter((m) => m.status !== "inactive")),
      );
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نسجّل الخدمة"));
    } finally {
      setBusy(false);
    }
  };

  const saveRule = async () => {
    const v =
      ruleType === "fixed" ? egp(ruleValue) : Number(normDigits(ruleValue));
    if (v === null || !Number.isFinite(v) || v < 0)
      return setError("اكتب العمولة صح");
    const res = await fetch("/api/services/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rules: {
          [key]: {
            mode: ruleMode,
            rule: { type: ruleType, value: v, tiers: [] },
          },
        },
      }),
    });
    if (!res.ok) return setError(await errorText(res, "مقدرناش نحفظ العمولة"));
    setRuleOpen(false);
    load();
  };

  const cancel = async (r: ServiceRow) => {
    if (
      !window.confirm(
        `تلغي «${r.label}» بـ ${formatMoney(r.amountPiasters)} من حسابات حِسبة؟ (ده مش بيلغيها عند الشركة)`,
      )
    )
      return;
    const res = await fetch(`/api/services/transactions/${r.id}/cancel`, {
      method: "POST",
    });
    if (!res.ok) setError(await errorText(res, "مقدرناش نلغي"));
    load();
  };

  const tabs = (
    <div
      role="tablist"
      style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}
    >
      {(
        [
          ["record", "📲 سجّل عملية"],
          ["machines", "💳 المحافظ والماكينات"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={tab === k}
          className={styles.undoBtn}
          style={tab === k ? { outline: "2px solid currentColor" } : undefined}
          onClick={() => setTab(k)}
          data-testid={`services-tab-${k}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (tab === "machines") {
    return (
      <div className={viewStyles.view} data-testid="page-services">
        <div className={styles.container}>{tabs}</div>
        <AlertsView mode="machines" />
      </div>
    );
  }

  return (
    <div className={viewStyles.view} data-testid="page-services">
      <div className={styles.container}>
        {tabs}
        <h2 className={styles.askTitle}>عملت خدمة لزبون؟</h2>
        <p
          className={styles.historyNote}
          style={{ textAlign: "start", margin: "0 0 8px" }}
        >
          سجّل العملية بعد ما تخلص على تطبيق أو ماكينة الشركة. حِسبة بتحسب
          عمولتك وبتظبط رصيد المحفظة والدرج — مكسبك هو العمولة بس، مش مبلغ
          العملية.
        </p>
        {data && (
          <div className={styles.totalBanner}>
            <span className={styles.totalLabel}>
              عمولات النهارده ({data.summary.count} عملية)
            </span>
            <span
              className={styles.totalAmount}
              data-testid="services-commission-today"
            >
              {formatMoney(data.summary.commissionPiasters)}
            </span>
          </div>
        )}
        <div className={styles.v19Form}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SERVICE_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={styles.undoBtn}
                aria-pressed={category === c}
                style={
                  category === c
                    ? { outline: "2px solid currentColor" }
                    : undefined
                }
                onClick={() => pickCategory(c)}
                data-testid={`services-cat-${c}`}
              >
                {SERVICE_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
          <label className={styles.lbl} htmlFor="sv-key">
            الخدمة
          </label>
          <select
            id="sv-key"
            className={styles.input}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setProvider(
                SERVICE_BY_KEY.get(e.target.value)?.providers[0] ?? "",
              );
              setCommission("");
            }}
            data-testid="services-key"
          >
            {SERVICES.filter((s) => s.category === category).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <label className={styles.lbl} htmlFor="sv-provider">
            الشركة
          </label>
          <input
            id="sv-provider"
            className={styles.input}
            dir="auto"
            list="sv-providers"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            data-testid="services-provider"
          />
          <datalist id="sv-providers">
            {def.providers.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <label className={styles.lbl} htmlFor="sv-amount">
            مبلغ العملية
          </label>
          <input
            id="sv-amount"
            className={styles.input}
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="services-amount"
          />
          <label className={styles.lbl} htmlFor="sv-float">
            {def.direction === "send" ? "اتعملت من رصيد" : "الفلوس وصلت على"}
          </label>
          <select
            id="sv-float"
            className={styles.input}
            value={floatId}
            onChange={(e) => setFloatId(e.target.value)}
            data-testid="services-float"
          >
            {machines.length === 0 && (
              <option value="">
                ضيف محفظة أو ماكينة من تبويب «المحافظ والماكينات»
              </option>
            )}
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {formatMoney(m.currentBalancePiasters)}
              </option>
            ))}
          </select>
          <label className={styles.lbl} htmlFor="sv-pay">
            {def.direction === "send" ? "الزبون دفع" : "الزبون خد فلوسه"}
          </label>
          <select
            id="sv-pay"
            className={styles.input}
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            data-testid="services-payment"
          >
            <option value="cash">كاش (الدرج)</option>
            {machines
              .filter((m) => m.id !== floatId)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <label className={styles.lbl} htmlFor="sv-commission">
            عمولتك {rule ? "" : "(مفيش عمولة محفوظة للخدمة دي)"}
          </label>
          <input
            id="sv-commission"
            className={styles.input}
            inputMode="decimal"
            placeholder={
              fromRule !== undefined ? (fromRule / 100).toString() : "0"
            }
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            data-testid="services-commission"
          />
          {money && (
            <div className={styles.totalBanner} data-testid="services-preview">
              <span className={styles.totalLabel}>
                {def.direction === "send"
                  ? `الزبون يدفع ${formatMoney(money.customerPiasters)} · يتخصم من الرصيد ${formatMoney(-money.floatDeltaPiasters)}`
                  : `يتحط على الرصيد ${formatMoney(money.floatDeltaPiasters)} · الزبون ياخد ${formatMoney(money.customerPiasters)}`}
              </span>
              <span className={styles.totalAmount}>
                +{formatMoney(commissionP ?? 0)}
              </span>
            </div>
          )}
          <label className={styles.lbl} htmlFor="sv-ref">
            رقم العملية عند الشركة (اختياري)
          </label>
          <input
            id="sv-ref"
            className={styles.input}
            dir="ltr"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          {error && (
            <p
              className={styles.formError}
              role="alert"
              data-testid="services-error"
            >
              {error}
            </p>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            disabled={busy}
            onClick={() => void save()}
            data-testid="services-save"
          >
            {busy ? "بيتسجّل…" : "سجّل الخدمة"}
          </button>
          <button
            type="button"
            className={styles.undoBtn}
            onClick={() => {
              setRuleOpen((v) => !v);
              setRuleMode(rule?.mode ?? def.defaultMode);
              setRuleType(rule?.rule.type ?? "fixed");
              setRuleValue(
                rule
                  ? String(
                      rule.rule.type === "fixed"
                        ? rule.rule.value / 100
                        : rule.rule.value,
                    )
                  : "",
              );
            }}
            data-testid="services-rule-toggle"
          >
            ⚙️ عمولة «{def.label}»
          </button>
          {ruleOpen && (
            <div style={{ display: "grid", gap: 8 }}>
              <select
                className={styles.input}
                value={ruleMode}
                onChange={(e) => setRuleMode(e.target.value as CommissionMode)}
                aria-label="العمولة بتيجي منين"
              >
                <option value="customer_fee">
                  الزبون بيدفعها زيادة / بتتخصم من اللي بياخده
                </option>
                <option value="provider_discount">
                  الشركة بتسيبها في رصيدي
                </option>
              </select>
              <select
                className={styles.input}
                value={ruleType}
                onChange={(e) =>
                  setRuleType(e.target.value as "fixed" | "percent")
                }
                aria-label="نوع العمولة"
              >
                <option value="fixed">مبلغ ثابت (جنيه)</option>
                <option value="percent">نسبة %</option>
              </select>
              <input
                className={styles.input}
                inputMode="decimal"
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
                placeholder={ruleType === "fixed" ? "جنيه" : "%"}
                aria-label="العمولة"
                data-testid="services-rule-value"
              />
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => void saveRule()}
                data-testid="services-rule-save"
              >
                احفظ العمولة
              </button>
            </div>
          )}
        </div>

        {data && data.items.length > 0 && (
          <div className={styles.listCard}>
            {data.items.map((r) => (
              <div
                key={r.id}
                className={`${styles.expenseRow} ${r.status === "cancelled" ? styles.cancelledRow : ""}`}
                data-testid="services-row"
              >
                <div className={styles.itemInfo}>
                  <b className={styles.itemCategory}>
                    {r.label} · {r.provider}
                  </b>
                  <span className={styles.itemMeta}>
                    {formatMoney(r.amountPiasters)} · من {r.floatMachine} ·{" "}
                    {r.payment}
                  </span>
                </div>
                <div className={styles.itemActions}>
                  <b>+{formatMoney(r.commissionPiasters)}</b>
                  {r.status === "cancelled" ? (
                    <span className={styles.cancelledTag}>اتلغت</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.undoBtn}
                      onClick={() => void cancel(r)}
                      data-testid="services-cancel"
                    >
                      ↩️
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ServicesView;
