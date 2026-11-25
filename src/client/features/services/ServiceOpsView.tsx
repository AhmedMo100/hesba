"use client";

/**
 * @file ServiceOpsView.tsx
 * @description «سجّل عملية خدمة» (ADR-0036) — in إدارة المحل, the «📲 خدمة» tab of «بيع حاجة»
 * (services are sold where everything is sold; «الخدمات» only manages them). A service the owner already did on
 * the provider's app / machine (Hesba has no provider connection and never claims one). The
 * commission comes from the service's ONE rule (the same rule the cashier uses) or is typed
 * when it differs, and is stored on the operation (a later rule change never rewrites it). It
 * is the only income — the operation's amount is never sales or profit. The machine / wallet
 * balance moves with the operation, atomically, on the server.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney, normDigits } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import { toCairoDateString } from "@/domain/time";
import { serviceMoney } from "@/domain/services-catalog";
import {
  slabFor,
  type ServiceCommissionRule,
} from "@/domain/service-commission";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { failureMessage } from "@/client/shared/quantity";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";

interface ServiceRow {
  id: string;
  label: string;
  direction: "send" | "receive";
  amountPiasters: number;
  commissionPiasters: number;
  customerPiasters: number;
  floatMachine: string;
  payment: string;
  status: "completed" | "cancelled";
  at: string;
}
interface ShopService {
  id: string;
  name: string;
  category: string;
  rule: ServiceCommissionRule;
  ruleText: string;
}
interface ServicesAnswer {
  items: ServiceRow[];
  summary: {
    count: number;
    commissionPiasters: number;
    cashier: { count: number; commissionPiasters: number };
  };
  services: ShopService[];
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

export function ServiceOpsView({
  onNavigate,
  embedded = false,
}: {
  onNavigate?: (route: NavRoute) => void;
  /** Inside «بيع حاجة»: no page frame and no title of its own. */
  embedded?: boolean;
} = {}) {
  const today = useMemo(() => toCairoDateString(new Date()), []);
  const [data, setData] = useState<ServicesAnswer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [machines, setMachines] = useState<PosMachine[]>([]);

  // The record form.
  const [serviceId, setServiceId] = useState("");
  const [direction, setDirection] = useState<"send" | "receive">("send");
  const [amount, setAmount] = useState("");
  const [commission, setCommission] = useState("");
  const [floatId, setFloatId] = useState("");
  const [payment, setPayment] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opId, setOpId] = useState(() => crypto.randomUUID());

  const load = useCallback(() => {
    fetch(`/api/services?from=${today}&to=${today}`, {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(await errorText(r, "حصلت مشكلة. جرّب تاني."));
        return (await r.json()) as ServicesAnswer;
      })
      .then((d) => {
        setData(d);
        setLoadError(null);
        setServiceId((cur) =>
          cur && d.services.some((s) => s.id === cur)
            ? cur
            : (d.services[0]?.id ?? ""),
        );
      })
      .catch((e: unknown) =>
        setLoadError(failureMessage(e, "حصلت مشكلة. جرّب تاني.")),
      );
  }, [today]);
  useEffect(load, [load]);
  useEffect(() => {
    void fetchStoreMachines().then((l) => {
      const active = l.filter((m) => m.status !== "inactive");
      setMachines(active);
      setFloatId((cur) =>
        cur && active.some((m) => m.id === cur) ? cur : active[0]?.id || "",
      );
    });
  }, []);

  const service = data?.services.find((s) => s.id === serviceId);
  const amountP = egp(amount);
  const typed = commission.trim() ? egp(commission) : undefined;
  const fromRule =
    service && amountP && amountP > 0
      ? slabFor(service.rule, amountP)?.piasters
      : undefined;
  const commissionP = typed !== undefined ? typed : fromRule;
  let money: ReturnType<typeof serviceMoney> | null = null;
  try {
    if (amountP && amountP > 0 && commissionP != null)
      money = serviceMoney(direction, "customer_fee", amountP, commissionP);
  } catch {
    money = null;
  }

  const save = async () => {
    setError(null);
    if (!service) return setError("اختار الخدمة");
    if (!amountP || amountP <= 0) return setError("اكتب مبلغ العملية");
    if (!floatId)
      return setError("ضيف المحفظة أو الماكينة الأول من «فلوس حِسبة»");
    if (commissionP === undefined)
      return setError(
        "المبلغ ده برة شرائح العمولة: اكتب العمولة بنفسك أو عدّل الخدمة",
      );
    if (!money) return setError("العمولة أكبر من مبلغ العملية");
    setBusy(true);
    try {
      const res = await fetch("/api/services/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opId,
          serviceProductId: service.id,
          direction,
          amountPiasters: amountP,
          floatMachineId: floatId,
          payment: payment === "cash" ? "cash" : { machineId: payment },
          ...(typed != null ? { commissionPiasters: typed } : {}),
        }),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نسجّل"));
      // A new id only after success: a retry of the same tap is recorded once.
      setOpId(crypto.randomUUID());
      setAmount("");
      setCommission("");
      load();
      void fetchStoreMachines().then((l) =>
        setMachines(l.filter((m) => m.status !== "inactive")),
      );
    } catch (e: unknown) {
      setError(failureMessage(e, "مقدرناش نسجّل"));
    } finally {
      setBusy(false);
    }
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
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) setError(await errorText(res, "مقدرناش نلغي"));
    load();
  };

  const body = (
    <>
      {loadError && (
        <div className={styles.formError} role="alert">
          {loadError}{" "}
          <button type="button" className={styles.undoBtn} onClick={load}>
            جرّب تاني
          </button>
        </div>
      )}
      {!data && !loadError && <p className={styles.historyNote}>بنحمّل…</p>}

      {data && (
        <>
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
          {data.services.length === 0 ? (
            <div className={styles.v19Form}>
              <p className={styles.historyNote}>
                لسه مفيش خدمات. ضيف أول خدمة (فوري، شحن، فودافون كاش…) وعمولتها.
              </p>
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => onNavigate?.("services")}
                data-testid="services-add-first"
              >
                + ضيف خدمة
              </button>
            </div>
          ) : (
            <div className={styles.v19Form}>
              <label className={styles.lbl} htmlFor="sv-service">
                الخدمة
              </label>
              <select
                id="sv-service"
                className={styles.input}
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  setCommission("");
                }}
                data-testid="services-service"
              >
                {data.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · عمولة {s.ruleText}
                  </option>
                ))}
              </select>
              <div className={styles.bigTabs}>
                <button
                  type="button"
                  className={`${styles.bigTab} ${direction === "send" ? styles.bigTabOn : ""}`}
                  onClick={() => setDirection("send")}
                  data-testid="services-dir-send"
                >
                  الزبون بيدفع
                  <small>دفع فاتورة / شحن / إيداع</small>
                </button>
                <button
                  type="button"
                  className={`${styles.bigTab} ${direction === "receive" ? styles.bigTabOn : ""}`}
                  onClick={() => setDirection("receive")}
                  data-testid="services-dir-receive"
                >
                  الزبون بياخد فلوس
                  <small>سحب من محفظة</small>
                </button>
              </div>
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
                {direction === "send" ? "اتعملت من رصيد" : "الفلوس وصلت على"}
              </label>
              <select
                id="sv-float"
                className={styles.input}
                value={floatId}
                onChange={(e) => setFloatId(e.target.value)}
                data-testid="services-float"
              >
                {machines.length === 0 && (
                  <option value="">ضيف ماكينة أو محفظة من «فلوس حِسبة»</option>
                )}
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {formatMoney(m.currentBalancePiasters)}
                  </option>
                ))}
              </select>
              <label className={styles.lbl} htmlFor="sv-pay">
                {direction === "send" ? "الزبون دفع" : "الزبون خد فلوسه"}
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
                عمولتك{" "}
                {fromRule === undefined && amountP
                  ? "(المبلغ برة الشرائح: اكتبها)"
                  : "(لو مختلفة اكتبها)"}
              </label>
              <input
                id="sv-commission"
                className={styles.input}
                inputMode="decimal"
                placeholder={
                  fromRule !== undefined ? String(fromRule / 100) : "0"
                }
                value={commission}
                onChange={(e) => setCommission(e.target.value)}
                data-testid="services-commission"
              />
              {money && (
                <div
                  className={styles.totalBanner}
                  data-testid="services-preview"
                >
                  <span className={styles.totalLabel}>
                    {direction === "send"
                      ? `الزبون يدفع ${formatMoney(money.customerPiasters)} · يتخصم من الرصيد ${formatMoney(-money.floatDeltaPiasters)}`
                      : `يتحط على الرصيد ${formatMoney(money.floatDeltaPiasters)} · الزبون ياخد ${formatMoney(money.customerPiasters)}`}
                  </span>
                  <span className={styles.totalAmount}>
                    مكسبك {formatMoney(commissionP ?? 0)}
                  </span>
                </div>
              )}
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
                {busy ? "بيتسجّل…" : "سجّل العملية"}
              </button>
              <p
                className={styles.historyNote}
                style={{ textAlign: "start", margin: 0 }}
              >
                سجّلها بعد ما تخلص على تطبيق أو ماكينة الشركة. مكسبك هو العمولة
                بس، مش مبلغ العملية.
              </p>
            </div>
          )}

          {data.items.length === 0 ? (
            <p className={styles.historyNote}>لسه مفيش عمليات النهارده.</p>
          ) : (
            <div className={styles.listCard}>
              {data.items.map((r) => (
                <div
                  key={r.id}
                  className={`${styles.expenseRow} ${r.status === "cancelled" ? styles.cancelledRow : ""}`}
                  data-testid="services-row"
                >
                  <div className={styles.itemInfo}>
                    <b className={styles.itemCategory}>{r.label}</b>
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
                        aria-label="إلغاء العملية"
                      >
                        ↩️
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
  if (embedded) return <div data-testid="page-service-ops">{body}</div>;
  return (
    <div className={viewStyles.view} data-testid="page-service-ops">
      <div className={styles.container}>
        <h2 className={styles.askTitle}>سجّل عملية خدمة</h2>
        {body}
      </div>
    </div>
  );
}

export default ServiceOpsView;
