"use client";

/**
 * @file MoneyView.tsx
 * @description «فلوس حِسبة» (ADR-0036): cards only. The cash (the drawer, from its last count:
 * its own colour, never charged by hand — its money comes from the shop's cash operations), then
 * every machine and wallet side by side, each with its balance and a small actions menu: «حط
 * رصيد» (the existing top-up form), rename, delete. «+ ماكينة» / «+ محفظة» add one. «حوّلت بين
 * حساباتي» and «سحبت لنفسي» open a small form (a transfer is never income or an expense; a
 * withdrawal is never an operating expense). Every balance is the server's
 * (`GET /api/money`), read each time the screen opens — so a sale, a purchase, an expense, a
 * collection, a supplier payment or a service done on any other screen shows here at once.
 * Money is never sales: a sale is revenue, this is where the money sits now.
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
import { Modal, useToast } from "@/client/shared/ui";
import { MachineTopupModal } from "../stock/MachineTopupModal";
import { MachineFormSheet, isWalletAccount } from "../alerts/MachineFormSheet";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";
import m$ from "./MoneyView.module.css";

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
    kind?: "machine" | "wallet";
  } | null>(null);
  // The small menu of one machine / wallet card, and the transfer / withdrawal form.
  const [menuFor, setMenuFor] = useState<PosMachine | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
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
      setMoveOpen(false);
      toast.show({ msg: "اتسجّلت ✅", kind: "ok" });
      load();
    } catch (e: unknown) {
      setFormError(failureMessage(e, "مقدرناش نسجّل"));
    } finally {
      setBusy(false);
    }
  };

  const cashAccount = data?.accounts.find((a) => a.kind === "cash");
  const otherAccounts = (data?.accounts ?? []).filter((a) => a.kind !== "cash");
  const openMove = (k: Kind) => {
    setKind(k);
    setFormError(null);
    setMoveOpen(true);
  };

  return (
    <div className={viewStyles.view} data-testid="page-money">
      <div className={m$.page}>
        <h2 className={m$.title}>فلوسي فين؟</h2>
        {error && (
          <p className={styles.formError} role="alert">
            {error}{" "}
            <button type="button" className={m$.link} onClick={load}>
              جرّب تاني
            </button>
          </p>
        )}
        {!data && !error && <p className={m$.note}>بنحمّل…</p>}
        {data && (
          <>
            <div className={m$.total}>
              <span>
                كل فلوسك
                {data.cashKnown ? "" : " (من غير الكاش — عدّ الدرج الأول)"}
              </span>
              <b data-testid="money-total">{formatMoney(data.totalPiasters)}</b>
            </div>

            <div className={m$.grid} data-testid="money-accounts">
              {cashAccount && (
                <div
                  className={`${m$.card} ${m$.cash}`}
                  data-testid="money-account"
                  data-kind="cash"
                >
                  <span className={m$.name}>💵 الكاش</span>
                  <b className={m$.bal} data-testid="money-cash-balance">
                    {cashAccount.balancePiasters === null
                      ? "عدّ الدرج أول مرة"
                      : formatMoney(cashAccount.balancePiasters)}
                  </b>
                  <span className={m$.sub}>
                    بيتغير لوحده مع البيع والمصاريف
                  </span>
                  {onNavigate && (
                    <button
                      type="button"
                      className={m$.cardBtn}
                      onClick={() => onNavigate("drawer")}
                      data-testid="money-drawer-count"
                    >
                      🧮 عدّ الدرج
                    </button>
                  )}
                </div>
              )}
              {otherAccounts.map((a) => {
                const machine = machines.find((x) => x.id === a.id);
                const wallet = machine ? isWalletAccount(machine) : false;
                return (
                  <div
                    key={a.id}
                    className={m$.card}
                    data-testid="money-account"
                    data-kind={wallet ? "wallet" : "machine"}
                  >
                    <div className={m$.cardTop}>
                      <span className={m$.name}>
                        {wallet ? "👛" : "💳"} {a.name}
                      </span>
                      {machine && (
                        <button
                          type="button"
                          className={m$.more}
                          onClick={() => setMenuFor(machine)}
                          aria-label={`إجراءات ${a.name}`}
                          data-testid="money-menu"
                        >
                          ⋯
                        </button>
                      )}
                    </div>
                    <b className={m$.bal}>
                      {a.balancePiasters === null
                        ? "—"
                        : formatMoney(a.balancePiasters)}
                    </b>
                    {machine && (
                      <button
                        type="button"
                        className={m$.cardBtn}
                        onClick={() => setTopup(machine)}
                        data-testid="money-topup"
                      >
                        ➕ حط رصيد
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={m$.addRow}>
              <button
                type="button"
                className={m$.addBtn}
                onClick={() =>
                  setMachineForm({ machine: null, kind: "machine" })
                }
                data-testid="money-add-machine"
              >
                + ماكينة
              </button>
              <button
                type="button"
                className={m$.addBtn}
                onClick={() =>
                  setMachineForm({ machine: null, kind: "wallet" })
                }
                data-testid="money-add-wallet"
              >
                + محفظة
              </button>
            </div>
            <div className={m$.addRow}>
              <button
                type="button"
                className={m$.actBtn}
                onClick={() => openMove("transfer")}
                data-testid="money-open-transfer"
              >
                🔁 حوّلت بين حساباتي
              </button>
              <button
                type="button"
                className={m$.actBtn}
                onClick={() => openMove("owner_withdrawal")}
                data-testid="money-open-withdrawal"
              >
                💸 سحبت لنفسي
              </button>
            </div>

            {(data.movements.length > 0 || data.machineActivity.length > 0) && (
              <details className={m$.history} data-testid="money-history">
                <summary>آخر الحركات</summary>
                {data.movements.slice(0, 10).map((mv) => (
                  <div
                    key={mv.id}
                    className={m$.histRow}
                    data-testid="money-movement"
                  >
                    <span>
                      <b>{mv.label}</b>
                      <small>
                        {[
                          mv.from && `من ${mv.from}`,
                          mv.to && `لـ ${mv.to}`,
                          when(mv.at),
                          mv.note,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    <b>{formatMoney(mv.amountPiasters)}</b>
                  </div>
                ))}
                {data.machineActivity.slice(0, 10).map((x) => (
                  <div key={x.id} className={m$.histRow}>
                    <span>
                      <b>{x.machine}</b>
                      <small>
                        {[x.source, when(x.at)].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                    <b>
                      {x.amountPiasters >= 0 ? "+" : "−"}
                      {formatMoney(Math.abs(x.amountPiasters))}
                    </b>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
        <p className={m$.note}>
          الفلوس هنا هي اللي معاك فعلاً، مش المبيعات. الكاش مبيتشحنش بإيدك:
          بيتغير لوحده مع البيع والمصاريف والعمليات الكاش.
        </p>

        {menuFor && (
          <Modal title={menuFor.name} onClose={() => setMenuFor(null)}>
            <div className={m$.menu} data-testid="money-menu-sheet">
              <button
                type="button"
                className={m$.menuBtn}
                onClick={() => {
                  setTopup(menuFor);
                  setMenuFor(null);
                }}
              >
                ➕ حط رصيد
              </button>
              <button
                type="button"
                className={m$.menuBtn}
                onClick={() => {
                  setMachineForm({ machine: menuFor });
                  setMenuFor(null);
                }}
                data-testid="money-rename"
              >
                ✏️ غيّر الاسم
              </button>
              <button
                type="button"
                className={`${m$.menuBtn} ${m$.danger}`}
                onClick={() => {
                  const target = menuFor;
                  setMenuFor(null);
                  void deleteMachine(target);
                }}
                data-testid="money-delete"
              >
                🗑️ امسح
              </button>
            </div>
          </Modal>
        )}

        {moveOpen && (
          <Modal title={KIND_LABEL[kind]} onClose={() => setMoveOpen(false)}>
            <div className={styles.v19Form} data-testid="money-move-form">
              <p className={m$.sub}>
                {kind === "owner_withdrawal"
                  ? "فلوس خدتها لنفسك من المحل: مش مصروف على المحل ومش بتقلل المكسب."
                  : "نقل فلوس من حساب لحساب (مثلاً من الكاش لفودافون كاش): لا مكسب ولا مصروف."}
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
                    {a.kind === "cash" ? "الكاش" : a.name}
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
                      .filter((a) => a.id !== from)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.kind === "cash" ? "الكاش" : a.name}
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
          </Modal>
        )}

        {machineForm && (
          <MachineFormSheet
            machine={machineForm.machine}
            kind={machineForm.kind}
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
                prev.map((x) => (x.id === updated.id ? updated : x)),
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
