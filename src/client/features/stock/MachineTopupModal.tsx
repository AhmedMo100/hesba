"use client";

import React, { useRef, useState } from "react";
import { Modal, Button, Field, Icon } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import {
  type PosMachine,
  addRemoteMachineTopup,
  setRemoteMachineExactBalance,
} from "@/client/shared/api/machines";
import { normalizeNumberString, parseEgpToPiasters } from "@/domain/money";

export interface MachineTopupModalProps {
  machine: PosMachine;
  storeId?: string;
  initialMode?: "topup" | "adjust";
  onClose: () => void;
  onSuccess: (updatedMachine: PosMachine) => void;
}

export function MachineTopupModal({
  machine,
  storeId,
  initialMode = "topup",
  onClose,
  onSuccess,
}: MachineTopupModalProps) {
  const [mode, setMode] = useState<"topup" | "adjust">(initialMode);

  // Topup inputs
  const [amountEgp, setAmountEgp] = useState("");
  const [source, setSource] = useState("خزينة المحل (كاش)");
  const [customSource, setCustomSource] = useState("");

  // Adjust inputs
  const currentBalancePiasters = machine.currentBalancePiasters || 0;
  const currentBalanceEgp = currentBalancePiasters / 100;
  const [targetBalanceEgp, setTargetBalanceEgp] = useState(
    currentBalanceEgp > 0 ? currentBalanceEgp.toString() : "",
  );
  const [adjustReason, setAdjustReason] = useState("تصحيح خطأ إدخال رصيد سابق");
  const [customReason, setCustomReason] = useState("");

  // Common inputs
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One opId per intended operation (ADR-0020): retrying the same amount after a failed or
  // unanswered request reuses it, so the server applies the operation at most once. Changing
  // the mode or amount means a new operation and a new opId.
  const opRef = useRef<{ key: string; opId: string } | null>(null);
  const opIdFor = (key: string): string => {
    if (opRef.current?.key !== key) {
      opRef.current = { key, opId: crypto.randomUUID() };
    }
    return opRef.current.opId;
  };

  // Adjust calculations
  const targetNum = parseFloat(normalizeNumberString(targetBalanceEgp)) || 0;
  const targetPiasters = Math.round(targetNum * 100);
  const deltaPiasters = targetPiasters - currentBalancePiasters;
  const deltaEgp = deltaPiasters / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "topup") {
      const cleanStr = normalizeNumberString(amountEgp).trim();
      let amountPiasters = 0;
      try {
        amountPiasters = parseEgpToPiasters(cleanStr);
      } catch {
        amountPiasters = 0;
      }

      if (!amountPiasters || amountPiasters <= 0) {
        setError("أدخل مبلغ الشحن / الإيداع بشكل صحيح");
        return;
      }

      setIsSubmitting(true);
      const resolvedSource =
        source === "أخرى" ? customSource.trim() || "مصدر مخصص" : source;

      try {
        const updatedList = await addRemoteMachineTopup(
          machine.id,
          amountPiasters,
          {
            source: resolvedSource,
            reference: reference.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          storeId,
          opIdFor(`topup:${machine.id}:${amountPiasters}`),
        );
        const target = updatedList.find((m) => m.id === machine.id) || machine;
        opRef.current = null;
        onSuccess(target);
        onClose();
      } catch (err: unknown) {
        // Nothing changed: the server did not confirm the top-up. Keep the form open.
        setError(
          err instanceof Error
            ? err.message
            : "فشل شحن رصيد الماكينة، جرّب تاني",
        );
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // mode === "adjust"
      if (targetNum < 0) {
        setError("رصيد الماكينة لا يمكن أن يكون سالباً");
        return;
      }

      setIsSubmitting(true);
      const resolvedReason =
        adjustReason === "أخرى"
          ? customReason.trim() || "تعديل رصيد مخصص"
          : adjustReason;

      try {
        const updatedList = await setRemoteMachineExactBalance(
          machine.id,
          targetPiasters,
          {
            source:
              deltaPiasters >= 0 ? "تصحيح رصيد (زيادة)" : "تصحيح رصيد (تخفيض)",
            reason: resolvedReason,
            reference: reference.trim() || undefined,
            notes: notes.trim() || undefined,
          },
          storeId,
          opIdFor(`adjust:${machine.id}:${targetPiasters}`),
        );
        const target = updatedList.find((m) => m.id === machine.id) || machine;
        opRef.current = null;
        onSuccess(target);
        onClose();
      } catch (err: unknown) {
        // Nothing changed: the server did not confirm the adjustment. Keep the form open.
        setError(
          err instanceof Error
            ? err.message
            : "فشل تعديل رصيد الماكينة، جرّب تاني",
        );
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <Modal
      title={
        mode === "topup"
          ? `إضافة رصيد: ${machine.name}`
          : `تعديل رصيد: ${machine.name}`
      }
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
            {mode === "topup" ? "تأكيد إضافة الرصيد ✓" : "حفظ وتصحيح الرصيد ✓"}
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {/* Mode Switcher Tabs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 6,
            background: "rgba(0, 0, 0, 0.2)",
            padding: 4,
            borderRadius: 12,
            border: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("topup");
              setError(null);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background:
                mode === "topup" ? "var(--br, #5a7d5a)" : "transparent",
              color: mode === "topup" ? "#122112" : "var(--ink2)",
              transition: "all 0.15s ease",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Icon n="plus" s={14} />
            <span>شحن رصيد إضافي</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("adjust");
              setError(null);
            }}
            style={{
              padding: "8px 10px",
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              border: "none",
              background:
                mode === "adjust" ? "var(--br, #5a7d5a)" : "transparent",
              color: mode === "adjust" ? "#122112" : "var(--ink2)",
              transition: "all 0.15s ease",
              fontFamily: "inherit",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <Icon n="edit" s={14} />
            <span>تعديل الرصيد مباشرة</span>
          </button>
        </div>

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
              {formatMoney(currentBalancePiasters)}
            </b>
          </div>
        </div>

        {mode === "topup" ? (
          <>
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
                <option value="خزينة المحل (كاش)">
                  خزينة المحل (كاش نقدي)
                </option>
                <option value="تحويل بنكي / إنستاباي">
                  تحويل بنكي / إنستاباي
                </option>
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
          </>
        ) : (
          <>
            {/* Target Exact Balance Input */}
            <Field label="الرصيد الفعلي الجديد للماكينة">
              <div style={{ position: "relative", width: "100%" }}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={targetBalanceEgp}
                  onChange={(e) => setTargetBalanceEgp(e.target.value)}
                  placeholder="اكتب الرصيد الصحيح..."
                  autoFocus
                  style={{
                    width: "100%",
                    padding: "10px 45px 10px 12px",
                    borderRadius: 10,
                    border: "1.5px solid var(--br, #5a7d5a)",
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

            {/* Live Delta Calculation Card */}
            <div
              style={{
                padding: "10px 12px",
                background:
                  deltaPiasters > 0
                    ? "rgba(16, 142, 92, 0.08)"
                    : deltaPiasters < 0
                      ? "rgba(207, 60, 60, 0.08)"
                      : "var(--sf)",
                border: "1px solid",
                borderColor:
                  deltaPiasters > 0
                    ? "rgba(16, 142, 92, 0.25)"
                    : deltaPiasters < 0
                      ? "rgba(207, 60, 60, 0.25)"
                      : "var(--line)",
                borderRadius: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--ink2)" }}>فارق التعديل:</span>
              <b
                style={{
                  color:
                    deltaPiasters > 0
                      ? "var(--ok, #108e5c)"
                      : deltaPiasters < 0
                        ? "var(--red, #cf3c3c)"
                        : "var(--ink2)",
                  fontSize: 14,
                }}
              >
                {deltaPiasters > 0
                  ? `+${deltaEgp} ج.م (زيادة بالرصيد)`
                  : deltaPiasters < 0
                    ? `${deltaEgp} ج.م (عجز / تخفيض بالرصيد)`
                    : "لا يوجد تغيير"}
              </b>
            </div>

            {/* Reason for Adjustment */}
            <Field label="سبب تعديل وتصحيح الرصيد">
              <select
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
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
                <option value="تصحيح خطأ إدخال رصيد سابق">
                  تصحيح خطأ إدخال رصيد سابق
                </option>
                <option value="جرد ومطابقة رصيد الماكينة الفعلي">
                  جرد ومطابقة رصيد الماكينة الفعلي
                </option>
                <option value="خصم رسوم شبكة أو اشتراك مزود">
                  خصم رسوم شبكة أو اشتراك مزود
                </option>
                <option value="أخرى">أخرى (سبب مخصص)</option>
              </select>
            </Field>

            {adjustReason === "أخرى" && (
              <Field label="اكتب سبب التعديل">
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="مثال: تسوية شهرية مع الشركة"
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
          </>
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
            placeholder="ملاحظات إضافية..."
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
                      <b
                        style={{
                          color:
                            tx.amountPiasters >= 0
                              ? "var(--ok, #108e5c)"
                              : "var(--red, #cf3c3c)",
                        }}
                      >
                        {tx.amountPiasters >= 0
                          ? `+${formatMoney(tx.amountPiasters)}`
                          : formatMoney(tx.amountPiasters)}
                      </b>
                      <span style={{ color: "var(--ink2)", marginRight: 6 }}>
                        ({tx.source || "حركة رصيد"})
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
