"use client";

/**
 * @file MoneyView.tsx
 * @description «فلوس حِسبة» (ADR-0039): cards only.
 *
 * - Under the title, once: «+ ماكينة / محفظة», «تحويل», «سحبت لنفسي». No action sits in a card
 *   except the small «⋯» menu (rename, delete).
 * - «فلوس الدرج» is never typed in and never counted here (owner, 2026-11-26): it is what the
 *   shop's cash operations put in and took out (`GET /api/money`). There is no «عدّ الدرج» and
 *   no «حط رصيد» on this page.
 * - A transfer is never income or an expense; a withdrawal comes out of the owner's profit and is
 *   never an operating expense. The history says which is which.
 * - Every balance is the server's, read each time the screen opens. Money is never sales.
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
import { MachineFormSheet, isWalletAccount } from "../alerts/MachineFormSheet";
import type { NavRoute } from "@/client/app-shell/BottomNav";
import viewStyles from "@/client/shared/styles/ViewLayout.module.css";
import styles from "../expenses/ExpensesView.module.css";
import c$ from "@/client/shared/styles/Cards.module.css";
import m$ from "./MoneyView.module.css";

type Kind = "owner_withdrawal" | "transfer";

const KIND_LABEL: Record<Kind, string> = {
  owner_withdrawal: "💸 سحبت لنفسي",
  transfer: "🔁 تحويل",
};

/** How each movement reads in the history: a transfer is never income or an expense; a
 *  withdrawal comes out of the owner's profit, never the shop's expenses. */
const MOVE_TAG: Record<string, string> = {
  transfer: "🔁 تحويل",
  owner_withdrawal: "💸 سحب شخصي من الأرباح",
  owner_deposit: "إيداع من صاحب المحل",
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

export function MoneyView(
  // The route callback is kept for the shell; this page has no link out any more.
  props: { onNavigate?: (route: NavRoute) => void } = {},
) {
  void props;
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
  const [addOpen, setAddOpen] = useState(false);
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

  const total = data?.totalPiasters ?? 0;
  return (
    <div
      className={`${viewStyles.view} ${c$.pageMoney}`}
      data-testid="page-money"
    >
      <div className={m$.page}>
        <h2 className={m$.title}>فلوسي فين؟</h2>
        {/* The page's three actions, once, in one row under the title — none inside the cards. */}
        <div className={m$.actionRow} data-testid="money-actions">
          <button
            type="button"
            className={`${m$.actionBtn} ${m$.actionMain}`}
            onClick={() => setAddOpen(true)}
            data-testid="money-add"
          >
            <i aria-hidden="true">➕</i>
            <span>ماكينة / محفظة</span>
          </button>
          <button
            type="button"
            className={m$.actionBtn}
            onClick={() => openMove("transfer")}
            data-testid="money-open-transfer"
          >
            <i aria-hidden="true">🔁</i>
            <span>تحويل</span>
          </button>
          <button
            type="button"
            className={m$.actionBtn}
            onClick={() => openMove("owner_withdrawal")}
            data-testid="money-open-withdrawal"
          >
            <i aria-hidden="true">💸</i>
            <span>سحبت لنفسي</span>
          </button>
        </div>
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
            <div className={c$.grid} data-testid="money-accounts">
              <div className={`${c$.card} ${c$.lead} ${c$.full}`}>
                <span className={c$.label}>كل فلوسك</span>
                <b className={c$.big} data-testid="money-total">
                  {formatMoney(total)}
                </b>
              </div>
              {cashAccount && (
                <div
                  className={`${c$.card} ${c$.full} ${(cashAccount.balancePiasters ?? 0) < 0 ? c$.toneOut : c$.toneOk}`}
                  data-testid="money-account"
                  data-kind="cash"
                >
                  <span className={c$.name}>💵 فلوس الدرج</span>
                  <b className={c$.big} data-testid="money-cash-balance">
                    {formatMoney(cashAccount.balancePiasters ?? 0)}
                  </b>
                  <span className={c$.sub}>
                    {(cashAccount.balancePiasters ?? 0) < 0
                      ? "طلع منه أكتر من اللي دخله"
                      : "من البيع والمصاريف"}
                  </span>
                </div>
              )}
              {otherAccounts.map((a) => {
                const machine = machines.find((x) => x.id === a.id);
                const wallet = machine ? isWalletAccount(machine) : false;
                return (
                  <div
                    key={a.id}
                    className={c$.card}
                    data-testid="money-account"
                    data-kind={wallet ? "wallet" : "machine"}
                  >
                    <div className={c$.top}>
                      <span className={c$.name}>
                        {wallet ? "👛" : "💳"} {a.name}
                      </span>
                      {machine && (
                        <button
                          type="button"
                          className={c$.more}
                          onClick={() => setMenuFor(machine)}
                          aria-label={`إجراءات ${a.name}`}
                          data-testid="money-menu"
                        >
                          ⋯
                        </button>
                      )}
                    </div>
                    <b className={c$.big}>
                      {a.balancePiasters === null
                        ? "—"
                        : formatMoney(a.balancePiasters)}
                    </b>
                    <span className={c$.sub}>
                      {wallet ? "محفظة" : "ماكينة"}
                    </span>
                  </div>
                );
              })}
            </div>

            {(data.movements.length > 0 || data.machineActivity.length > 0) && (
              <details className={c$.details} data-testid="money-history">
                <summary>آخر الحركات</summary>
                <div className={c$.rows}>
                  {data.movements.slice(0, 10).map((mv) => (
                    <div
                      key={mv.id}
                      className={c$.row}
                      data-testid="money-movement"
                      data-kind={mv.kind}
                    >
                      <span>
                        <span
                          className={`${c$.chip} ${mv.kind === "transfer" ? c$.toneInfo : c$.toneLow}`}
                        >
                          {MOVE_TAG[mv.kind] ?? mv.label}
                        </span>{" "}
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
                    <div key={x.id} className={c$.row}>
                      <span>
                        <b>{x.machine}</b>{" "}
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
                </div>
              </details>
            )}
          </>
        )}
        <p className={m$.note}>
          دي الفلوس اللي معاك فعلاً، مش المبيعات. التحويل مش مكسب ولا مصروف،
          والسحب لنفسك بيطلع من أرباحك مش من مصاريف المحل.
        </p>

        {addOpen && (
          <Modal title="تضيف إيه؟" onClose={() => setAddOpen(false)}>
            <div className={m$.menu} data-testid="money-add-sheet">
              <button
                type="button"
                className={m$.menuBtn}
                onClick={() => {
                  setAddOpen(false);
                  setMachineForm({ machine: null, kind: "machine" });
                }}
                data-testid="money-add-machine"
              >
                💳 ماكينة
              </button>
              <button
                type="button"
                className={m$.menuBtn}
                onClick={() => {
                  setAddOpen(false);
                  setMachineForm({ machine: null, kind: "wallet" });
                }}
                data-testid="money-add-wallet"
              >
                👛 محفظة
              </button>
            </div>
          </Modal>
        )}

        {menuFor && (
          <Modal title={menuFor.name} onClose={() => setMenuFor(null)}>
            <div className={m$.menu} data-testid="money-menu-sheet">
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
      </div>
    </div>
  );
}

export default MoneyView;
