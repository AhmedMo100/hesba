"use client";

/**
 * @file ModeSwitchSheet.tsx
 * @description «طريقة التشغيل» in the shop menu (ADR-0033): the owner switches between إدارة المحل
 * and الكاشير الذكي. Only the mode changes — the sheet says so before the owner confirms, and the
 * server changes nothing else (no data, no trial restart).
 */
import React, { useState } from "react";
import { Modal, useToast } from "@/client/shared/ui";
import {
  MODE_LABELS,
  isOperatingMode,
  type OperatingMode,
} from "@/domain/operating-mode";
import { ModeChoice } from "./ModeChoice";
import styles from "./Subscription.module.css";

export function ModeSwitchSheet({
  current,
  onClose,
  onChanged,
}: {
  current: string | undefined;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<OperatingMode | null>(
    isOperatingMode(current) ? current : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = picked !== null && picked !== current;

  const save = async () => {
    if (!picked || !changing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/store/operating-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatingMode: picked }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(body?.error?.message || "مقدرناش نغيّر طريقة التشغيل");
      await onChanged();
      toast.show({ msg: `اتغيّرت لـ «${MODE_LABELS[picked]}» ✅`, kind: "ok" });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "مقدرناش نغيّر طريقة التشغيل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="⚙️ طريقة التشغيل" onClose={onClose}>
      <div data-testid="mode-switch">
        <ModeChoice value={picked} onChange={setPicked} disabled={busy} />
        {changing && (
          <div className={styles.sumbox} data-testid="mode-switch-note">
            <p className={styles.note}>
              مفيش أي حاجة هتتمسح أو تتغيّر: المنتجات والمخزون والأسعار والزباين
              والموردين والديون والمصروفات والدرج والمحافظ وكل البيعات القديمة
              زي ما هي.
            </p>
            <p className={styles.note}>
              {picked === "pos"
                ? "الكاشير هيظهر، وكل بيعة من دلوقتي هتتسجل بمنتجاتها. مبيعات الأيام اللي فاتت مش هتتحول لفواتير."
                : "الكاشير هيختفي من القايمة، وهتسجل إجمالي مبيعات اليوم. الفواتير القديمة محفوظة في التقارير."}
            </p>
          </div>
        )}
        {error && <div className={styles.err}>{error}</div>}
        <button
          type="button"
          className={styles.btn}
          disabled={!changing || busy}
          onClick={() => void save()}
          data-testid="mode-switch-save"
        >
          {busy
            ? "بيتحفظ…"
            : changing
              ? `غيّر لـ «${MODE_LABELS[picked!]}»`
              : "دي طريقتك دلوقتي"}
        </button>
      </div>
    </Modal>
  );
}
