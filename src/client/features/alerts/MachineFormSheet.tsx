"use client";

/**
 * @file MachineFormSheet.tsx
 * @description V19 machForm: a new machine / wallet (its name and the balance on it now), or
 * a new name for one. Nothing else: the list of machines is not in this form.
 */

import React, { useRef, useState } from "react";
import { Modal } from "@/client/shared/ui";
import { parseEgpStrict } from "@/domain/money";
import {
  addRemoteMachineTopup,
  fetchStoreMachines,
  type PosMachine,
} from "@/client/shared/api/machines";
import styles from "./AlertsView.module.css";

export interface MachineFormSheetProps {
  /** Rename this machine; none = a new one. */
  machine?: PosMachine | null;
  storeId?: string;
  onClose: () => void;
  onSaved: (machines: PosMachine[], message: string) => void;
}

/** The balance a new machine starts with is recorded as its first top-up. */
export const OPENING_BALANCE_SOURCE = "رصيد أول ما اتسجلت";

export function MachineFormSheet({
  machine,
  storeId,
  onClose,
  onSaved,
}: MachineFormSheetProps) {
  const [name, setName] = useState(machine?.name ?? "");
  const [balance, setBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The machine created by a first attempt: a retry only adds its balance.
  const createdRef = useRef<string | null>(null);
  const topupOp = useRef<string>(crypto.randomUUID());

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("اكتب الاسم");
      return;
    }
    const opening =
      machine || balance.trim() === "" ? 0 : parseEgpStrict(balance);
    if (opening === null || opening < 0) {
      setError("اكتب الرصيد بالجنيه، أو سيبه فاضي");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let id = machine?.id ?? createdRef.current;
      if (machine || !id) {
        const res = await fetch("/api/machines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            machine
              ? {
                  id: machine.id,
                  name: trimmed,
                  provider: machine.provider || trimmed,
                  terminalId: machine.terminalId ?? null,
                  status: machine.status,
                  notes: machine.notes ?? null,
                }
              : { name: trimmed, provider: trimmed },
          ),
        });
        const json = (await res.json().catch(() => null)) as {
          machine?: PosMachine;
          error?: { message?: string };
        } | null;
        if (!res.ok || !json?.machine) {
          throw new Error(json?.error?.message || "مقدرناش نحفظ الماكينة");
        }
        id = json.machine.id;
        if (!machine) createdRef.current = id;
      }
      if (!machine && opening > 0 && id) {
        await addRemoteMachineTopup(
          id,
          opening,
          { source: OPENING_BALANCE_SOURCE },
          storeId,
          topupOp.current,
        );
      }
      const list = await fetchStoreMachines(storeId);
      onSaved(list, machine ? "اتغيّر الاسم ✅" : "اتحفظت الماكينة ✅");
    } catch (err) {
      setError(err instanceof Error ? err.message : "حصلت مشكلة، جرّب تاني");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={machine ? "تعديل الاسم" : "ماكينة أو محفظة جديدة"}
      onClose={onClose}
    >
      <div data-testid="machine-form">
        <label className={styles.lbl} htmlFor="mf-name">
          الاسم
        </label>
        <input
          id="mf-name"
          className={styles.input}
          dir="auto"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="مثلاً: فوري، فودافون كاش، إنستاباي"
          data-testid="machine-form-name"
        />
        {!machine && (
          <>
            <label className={styles.lbl} htmlFor="mf-balance">
              الرصيد دلوقتي
            </label>
            <input
              id="mf-balance"
              className={styles.input}
              type="number"
              inputMode="decimal"
              min="0"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="0"
              data-testid="machine-form-balance"
            />
          </>
        )}
        {error && (
          <div className={styles.formError} role="alert">
            {error}
          </div>
        )}
        <button
          type="button"
          className={styles.btn}
          disabled={busy}
          onClick={() => void save()}
          data-testid="machine-form-save"
        >
          {busy ? "بيتحفظ…" : "حفظ"}
        </button>
      </div>
    </Modal>
  );
}

export default MachineFormSheet;
