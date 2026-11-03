"use client";

import React, { useState } from "react";
import { Modal, Button, Field } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import { type PosMachine, addMachineTopup } from "../../shared/machines";

export interface MachineTopupModalProps {
  machine: PosMachine;
  storeId?: string;
  onClose: () => void;
  onSuccess: (updatedMachine: PosMachine) => void;
}

export function MachineTopupModal({
  machine,
  storeId = "default",
  onClose,
  onSuccess,
}: MachineTopupModalProps) {
  const [amountEgp, setAmountEgp] = useState("");
  const [source, setSource] = useState("خزينة المحل (كاش)");
  const [customSource, setCustomSource] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amountEgp);
    if (!val || val <= 0) {
      setError("أدخل مبلغ الشحن / الإيداع بشكل صحيح");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const amountPiasters = Math.round(val * 100);
    const resolvedSource =
      source === "أخرى" ? customSource.trim() || "مصدر مخصص" : source;

    const updatedList = addMachineTopup(
      machine.id,
      amountPiasters,
      {
        source: resolvedSource,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      storeId,
    );

    const target = updatedList.find((m) => m.id === machine.id) || machine;
    setIsSubmitting(false);
    onSuccess(target);
    onClose();
  };

  return (
    <Modal
      title={`إضافة رصيد: ${machine.name}`}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={isSubmitting}>
            إلغاء
          </Button>
          <Button
            kind="primary"
            onClick={handleSubmit}
            disabled={isSubmitting}
            loading={isSubmitting}
          >
            تأكيد إضافة الرصيد ✓
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {error && (
          <div
            style={{
              color: "var(--red, #cf3c3c)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}

        {/* Current Machine Balance Card */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--sf2)",
            borderRadius: 12,
            border: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <b style={{ fontSize: 14, color: "var(--ink)", display: "block" }}>
              {machine.name}
            </b>
            <small style={{ color: "var(--ink2)", fontSize: 12 }}>
              {machine.provider}{" "}
              {machine.terminalId ? `(${machine.terminalId})` : ""}
            </small>
          </div>
          <div style={{ textAlign: "end" }}>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink2)",
                fontWeight: 600,
                display: "block",
              }}
            >
              الرصيد المتاح الحالي
            </span>
            <b
              style={{
                fontSize: 15,
                color: "var(--ok, #108e5c)",
                fontWeight: 800,
              }}
            >
              {formatMoney(machine.currentBalancePiasters || 0)}
            </b>
          </div>
        </div>

        {/* Topup Amount */}
        <Field label="مبلغ الشحن / الإيداع المطلوب إضافته">
          <div style={{ position: "relative", width: "100%" }}>
            <input
              type="number"
              step="any"
              min="1"
              value={amountEgp}
              onChange={(e) => setAmountEgp(e.target.value)}
              placeholder="مثال: 1000"
              autoFocus
              style={{
                width: "100%",
                padding: "10px 45px 10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 16,
                fontWeight: 700,
                background: "var(--sf)",
                color: "var(--ink)",
                boxSizing: "border-box",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--ink2)",
              }}
            >
              ج.م
            </span>
          </div>
        </Field>

        {/* Source of Funds */}
        <Field label="مصدر الرصيد (من أين تم دفع المبلغ)">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
              background: "var(--sf)",
              color: "var(--ink)",
              boxSizing: "border-box",
            }}
          >
            <option value="خزينة المحل (كاش)">خزينة المحل (كاش نقدي)</option>
            <option value="تحويل بنكي / إنستاباي">تحويل بنكي / إنستاباي</option>
            <option value="محفظة فودافون كاش">محفظة فودافون كاش</option>
            <option value="شحن مباشر من مندوب الشركة">
              شحن مباشر من مندوب الشركة
            </option>
            <option value="أخرى">أخرى (مصدر مخصص)</option>
          </select>
        </Field>

        {source === "أخرى" && (
          <Field label="اكتب مصدر الرصيد">
            <input
              type="text"
              value={customSource}
              onChange={(e) => setCustomSource(e.target.value)}
              placeholder="مثال: سلفة من حساب المالك"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14,
                background: "var(--sf)",
                color: "var(--ink)",
                boxSizing: "border-box",
              }}
            />
          </Field>
        )}

        {/* Reference Number */}
        <Field label="رقم المرجع / الإيصال (اختياري)">
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="مثال: REF-983214"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
              background: "var(--sf)",
              color: "var(--ink)",
              boxSizing: "border-box",
            }}
          />
        </Field>

        {/* Notes */}
        <Field label="ملاحظات (اختياري)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثال: شحن رصيد لتغطية فواتير بداية الشهر"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
              background: "var(--sf)",
              color: "var(--ink)",
              boxSizing: "border-box",
            }}
          />
        </Field>

        {/* Recent Balance Movements Audit */}
        {machine.balanceTransactions &&
          machine.balanceTransactions.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "var(--ink2)",
                  marginBottom: 6,
                }}
              >
                آخر حركات الرصيد للماكينة:
              </span>
              <div
                style={{
                  maxHeight: 140,
                  overflowY: "auto",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  background: "var(--sf)",
                }}
              >
                {machine.balanceTransactions.slice(0, 5).map((tx) => (
                  <div
                    key={tx.id}
                    style={{
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--line)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <b style={{ color: "var(--ok, #108e5c)" }}>
                        +{formatMoney(tx.amountPiasters)}
                      </b>
                      <span style={{ color: "var(--ink2)", marginRight: 6 }}>
                        ({tx.source || "إيداع"})
                      </span>
                    </div>
                    <span style={{ color: "var(--ink2)", fontSize: 11 }}>
                      {new Date(tx.createdAt).toLocaleDateString("ar-EG", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
      </form>
    </Modal>
  );
}
