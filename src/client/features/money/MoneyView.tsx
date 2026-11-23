"use client";

/**
 * @file MoneyView.tsx
 * @description «فلوس حِسبة»: «فلوسي فين؟». The drawer (what should be in it, from the last
 * count) and every machine / wallet with its balance, the total, and the latest movements.
 * The owner records here what no other screen records: taking money for himself and moving
 * money between the drawer and the wallets. A machine / wallet gets balance through its
 * existing top-up form («حط رصيد»); the drawer is never charged by hand — its money comes from
 * the shop's cash operations. Money is never sales: a sale is revenue, this is where the money
 * sits now.
 */
import React, { useCallback, useEffect, useState } from "react";
import { formatMoney, normDigits } from "@/client/shared/i18n";
import { parseEgpStrict } from "@/domain/money";
import type { MoneyOverview } from "@/schemas/money";
import { failureMessage } from "@/client/shared/quantity";
import { useAuth } from "@/client/shared/auth";
import {
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import { useToast } from "@/client/shared/ui";
import { MachineTopupModal } from "../stock/MachineTopupModal";
import { MachineFormSheet } from "../alerts/MachineFormSheet";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";

type Kind = "owner_withdrawal" | "transfer";

const KIND_LABEL: Record<Kind, string> = {
  owner_withdrawal: "💸 سحبت لنفسي",
  transfer: "🔁 حوّلت بين حساباتي",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

async function errorText(res: Response, fallback: string) {
  const b = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return b?.error?.message || fallback;
}

const accountRef = (id: string) => (id === "cash" ? "cash" : { machineId: id });

export function MoneyView({
  onNavigate,
}: {
  /** Opens the drawer count («عدّ الدرج»). */
  onNavigate?: (route: NavRoute) => void;
} = {}) {
  const [data, setData] = useState<MoneyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("owner_withdrawal");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("cash");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  const { session } = useAuth();
  const toast = useToast();
  // The shop's machines (full rows) for the existing top-up form.
  const [machines, setMachines] = useState<PosMachine[]>([]);
  const [topup, setTopup] = useState<PosMachine | null>(null);
  const [machineForm, setMachineForm] = useState<{
    machine: PosMachine | null;
  } | null>(null);
  const reloadMachines = useCallback(() => {
    void fetchStoreMachines()
      .then(setMachines)
      .catch(() => undefined);
  }, []);
  useEffect(reloadMachines, [reloadMachines]);

  /** Only an empty machine is removed (its history stays on the server). */
  const deleteMachine = async (m: PosMachine) => {
    if ((m.currentBalancePiasters || 0) > 0) {
      toast.show({ msg: "الرصيد لازم يبقى صفر قبل المسح", kind: "err" });
      return;
    }
    if (!window.confirm(`تمسح «${m.name}»؟`)) return;
    try {
      const res = await fetch(`/api/machines?id=${encodeURIComponent(m.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نمسحها"));
      toast.show({ msg: "اتمسحت", kind: "ok" });
      reloadMachines();
      load();
    } catch (e: unknown) {
      toast.show({ msg: failureMessage(e, "مقدرناش نمسحها"), kind: "err" });
    }
  };

  const load = useCallback(() => {
    fetch("/api/money", { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorText(r, "مقدرناش نجيب الفلوس"));
        return (await r.json()) as MoneyOverview;
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => setError(failureMessage(e, "مفيش نت")));
  }, []);
  useEffect(load, [load]);

  const accounts = data?.accounts ?? [];
  const save = async () => {
    setFormError(null);
    const piasters = parseEgpStrict(normDigits(amount).trim());
    if (piasters === null || piasters <= 0) return setFormError("اكتب المبلغ");
    const body: Record<string, unknown> = {
      opId,
      kind,
      amountPiasters: piasters,
      note: note.trim() || null,
    };
    body["from"] = accountRef(from);
    if (kind === "transfer") {
      if (!to) return setFormError("اختار الفلوس رايحة فين");
      body["to"] = accountRef(to);
    }
    setBusy(true);
    try {
      const res = await fetch("/api/money/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorText(res, "مقدرناش نسجّل"));
      setOpId(crypto.randomUUID());
      setAmount("");
      setNote("");
      load();
    } catch (e: unknown) {
      setFormError(failureMessage(e, "مقدرناش نسجّل"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={viewStyles.view} data-testid="page-money">
      <div className={styles.container}>
        <h2 className={styles.askTitle}>فلوسي فين؟</h2>
        {error && (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        )}
        {data && (
          <>
            <div className={styles.totalBanner}>
              <span className={styles.totalLabel}>
                كل فلوسك{data.cashKnown ? "" : " (من غير الدرج — عدّه الأول)"}
              </span>
              <span className={styles.totalAmount} data-testid="money-total">
                {formatMoney(data.totalPiasters)}
              </span>
            </div>
            <div className={styles.moneyGrid} data-testid="money-accounts">
              {data.accounts.map((a) => {
                const machine = machines.find((m) => m.id === a.id);
                return (
                  <div
                    key={a.id}
                    className={`${styles.moneyCard} ${a.kind === "cash" ? styles.moneyCardCash : ""}`}
                    data-testid="money-account"
                  >
                    <span className={styles.moneyCardName}>
                      {a.kind === "cash" ? "🧮" : "💳"} {a.name}
                    </span>
                    <b className={styles.moneyCardBal}>
                      {a.balancePiasters === null
                        ? "عدّه أول مرة"
                        : formatMoney(a.balancePiasters)}
                    </b>
                    {a.kind === "cash" ? (
                      <>
                        <span className={styles.moneyCardNote}>
                          بيتغير لوحده مع البيع والمصاريف
                        </span>
                        {onNavigate && (
                          <button
                            type="button"
                            className={styles.moneyBtn}
                            onClick={() => onNavigate("drawer")}
                            data-testid="money-drawer-count"
                          >
                            🧮 عدّ الدرج
                          </button>
                        )}
                      </>
                    ) : (
                      machine && (
                        <div className={styles.moneyBtns}>
                          <button
                            type="button"
                            className={styles.moneyBtn}
                            onClick={() => setTopup(machine)}
                            data-testid="money-topup"
                          >
                            ➕ حط رصيد
                          </button>
                          <button
                            type="button"
                            className={styles.moneyBtnGhost}
                            onClick={() => setMachineForm({ machine })}
                            data-testid="money-rename"
                            aria-label={`غيّر اسم ${machine.name}`}
                          >
                            ✏️ الاسم
                          </button>
                          <button
                            type="button"
                            className={styles.moneyBtnGhost}
                            onClick={() => void deleteMachine(machine)}
                            data-testid="money-delete"
                            aria-label={`امسح ${machine.name}`}
                          >
                            🗑️
                          </button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className={`${styles.moneyCard} ${styles.moneyAdd}`}
                onClick={() => setMachineForm({ machine: null })}
                data-testid="money-add-machine"
              >
                <span aria-hidden="true">➕</span>
                <b>ماكينة / محفظة</b>
              </button>
            </div>
          </>
        )}

        <h3 className={styles.askTitle} style={{ fontSize: 18 }}>
          سجّل حركة فلوس
        </h3>
        <div className={styles.v19Form}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={styles.undoBtn}
                aria-pressed={kind === k}
                style={
                  kind === k ? { outline: "2px solid currentColor" } : undefined
                }
                onClick={() => setKind(k)}
                data-testid={`money-kind-${k}`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p
            className={styles.historyNote}
            style={{ textAlign: "start", margin: 0 }}
          >
            {kind === "owner_withdrawal"
              ? "فلوس خدتها لنفسك من المحل: مش مصروف على المحل ومش بتقلل المكسب."
              : "نقل فلوس من حساب لحساب (مثلاً من الدرج لفودافون كاش): لا مكسب ولا مصروف."}
          </p>
          <label className={styles.lbl} htmlFor="mv-from">
            منين؟
          </label>
          <select
            id="mv-from"
            className={styles.input}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            data-testid="money-from"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {kind === "transfer" && (
            <>
              <label className={styles.lbl} htmlFor="mv-to">
                لفين؟
              </label>
              <select
                id="mv-to"
                className={styles.input}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="money-to"
              >
                <option value="">اختار…</option>
                {accounts
                  .filter((a) => kind !== "transfer" || a.id !== from)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </>
          )}
          <label className={styles.lbl} htmlFor="mv-amount">
            المبلغ
          </label>
          <input
            id="mv-amount"
            className={styles.input}
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            data-testid="money-amount"
          />
          <label className={styles.lbl} htmlFor="mv-note">
            ملاحظة (اختياري)
          </label>
          <input
            id="mv-note"
            className={styles.input}
            dir="auto"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {formError && (
            <p
              className={styles.formError}
              role="alert"
              data-testid="money-error"
            >
              {formError}
            </p>
          )}
          <button
            type="button"
            className={styles.saveBtn}
            disabled={busy}
            onClick={() => void save()}
            data-testid="money-save"
          >
            {busy ? "بيتسجّل…" : "سجّل"}
          </button>
        </div>

        {data && data.movements.length > 0 && (
          <div className={styles.listCard} data-testid="money-movements">
            {data.movements.map((m) => (
              <div
                key={m.id}
                className={styles.expenseRow}
                data-testid="money-movement"
              >
                <div className={styles.itemInfo}>
                  <b className={styles.itemCategory}>{m.label}</b>
                  <span className={styles.itemMeta}>
                    {[
                      m.from && `من ${m.from}`,
                      m.to && `لـ ${m.to}`,
                      when(m.at),
                      m.note,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <b>{formatMoney(m.amountPiasters)}</b>
              </div>
            ))}
          </div>
        )}
        {data && data.machineActivity.length > 0 && (
          <>
            <h3 className={styles.askTitle} style={{ fontSize: 16 }}>
              آخر حركات المحافظ والماكينات
            </h3>
            <div className={styles.listCard}>
              {data.machineActivity.slice(0, 15).map((a) => (
                <div key={a.id} className={styles.expenseRow}>
                  <div className={styles.itemInfo}>
                    <b className={styles.itemCategory}>{a.machine}</b>
                    <span className={styles.itemMeta}>
                      {[a.source, when(a.at)].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <b>
                    {a.amountPiasters >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(a.amountPiasters))}
                  </b>
                </div>
              ))}
            </div>
          </>
        )}
        <p className={styles.historyNote}>
          الفلوس هنا هي اللي معاك فعلاً، مش المبيعات: البيع الآجل بيبان في «ليك»
          لحد ما يتحصّل، والبضاعة ليها قيمة في التقارير. الدرج مبيتشحنش بإيدك:
          فلوسه بتتغير لوحدها مع البيع والمصاريف والعمليات الكاش.
        </p>
        {machineForm && (
          <MachineFormSheet
            machine={machineForm.machine}
            storeId={session?.store?.id}
            onClose={() => setMachineForm(null)}
            onSaved={(list, message) => {
              setMachineForm(null);
              setMachines(list);
              toast.show({ msg: message, kind: "ok" });
              load();
            }}
          />
        )}
        {topup && (
          <MachineTopupModal
            machine={topup}
            initialMode="topup"
            topupOnly
            storeId={session?.store?.id}
            onClose={() => setTopup(null)}
            onSuccess={(updated) => {
              setTopup(null);
              setMachines((prev) =>
                prev.map((m) => (m.id === updated.id ? updated : m)),
              );
              toast.show({
                msg: `تم شحن رصيد «${updated.name}» ✓`,
                kind: "ok",
              });
              load();
            }}
          />
        )}
      </div>
    </div>
  );
}

export default MoneyView;
