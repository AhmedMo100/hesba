"use client";

import React, { useState, useMemo } from "react";
import { Modal, Button, Field, Seg } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";
import type { StockInventoryItem } from "./StockView";
import styles from "./StockView.module.css";

export interface AdjustStockModalProps {
  item: StockInventoryItem;
  onClose: () => void;
  onSaved: () => void;
}

export function AdjustStockModal({
  item,
  onClose,
  onSaved,
}: AdjustStockModalProps) {
  const isWeight = item.unitMode === "weight";
  const packQty = item.packQty || 1;

  const [mode, setMode] = useState<"set" | "delta">("set");

  // Initial values for "set" mode derived from current stock
  const initialCartons = useMemo(() => {
    if (isWeight) return "";
    if (packQty > 1 && item.currentStockBase > 0) {
      return Math.floor(item.currentStockBase / packQty).toString();
    }
    return "";
  }, [isWeight, packQty, item.currentStockBase]);

  const initialPieces = useMemo(() => {
    if (isWeight) return "";
    if (packQty > 1) {
      return (item.currentStockBase % packQty).toString();
    }
    return item.currentStockBase > 0 ? item.currentStockBase.toString() : "0";
  }, [isWeight, packQty, item.currentStockBase]);

  const initialKg = useMemo(() => {
    if (!isWeight) return "";
    return item.currentStockBase > 0
      ? (item.currentStockBase / 1000).toString()
      : "0";
  }, [isWeight, item.currentStockBase]);

  // Set mode state
  const [setCartons, setSetCartons] = useState(initialCartons);
  const [setPieces, setSetPieces] = useState(initialPieces);
  const [setWeight, setSetWeight] = useState(initialKg);
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">("kg");

  // Delta mode state
  const [deltaSign, setDeltaSign] = useState<"add" | "sub">("add");
  const [deltaCartons, setDeltaCartons] = useState("");
  const [deltaPieces, setDeltaPieces] = useState("");
  const [deltaWeight, setDeltaWeight] = useState("");

  const [reason, setReason] = useState("جرد دوري");
  const [customReason, setCustomReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute target balance for "set" mode
  const targetBase = useMemo(() => {
    if (isWeight) {
      const w = parseFloat(setWeight) || 0;
      return weightUnit === "kg" ? Math.round(w * 1000) : Math.round(w);
    } else {
      const c = parseInt(setCartons, 10) || 0;
      const p = parseInt(setPieces, 10) || 0;
      return c * packQty + p;
    }
  }, [isWeight, setWeight, weightUnit, setCartons, setPieces, packQty]);

  // Compute delta for "delta" mode
  const deltaBase = useMemo(() => {
    const sign = deltaSign === "add" ? 1 : -1;
    if (isWeight) {
      const w = parseFloat(deltaWeight) || 0;
      const grams = weightUnit === "kg" ? Math.round(w * 1000) : Math.round(w);
      return sign * grams;
    } else {
      const c = parseInt(deltaCartons, 10) || 0;
      const p = parseInt(deltaPieces, 10) || 0;
      return sign * (c * packQty + p);
    }
  }, [
    deltaSign,
    isWeight,
    deltaWeight,
    weightUnit,
    deltaCartons,
    deltaPieces,
    packQty,
  ]);

  // Calculated difference
  const diffBase = useMemo(() => {
    if (mode === "set") {
      return targetBase - item.currentStockBase;
    } else {
      return deltaBase;
    }
  }, [mode, targetBase, item.currentStockBase, deltaBase]);

  // Resulting new balance
  const resultingBalanceBase = useMemo(() => {
    if (mode === "set") return targetBase;
    return item.currentStockBase + deltaBase;
  }, [mode, targetBase, item.currentStockBase, deltaBase]);

  const formatQtyDiff = (diff: number) => {
    if (diff === 0) return "لا يوجد تغيير في الرصيد";
    const sign = diff > 0 ? "+" : "";
    if (isWeight) {
      const kg = diff / 1000;
      return `${sign}${kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`;
    }
    if (packQty > 1) {
      const absDiff = Math.abs(diff);
      const c = Math.floor(absDiff / packQty);
      const p = absDiff % packQty;
      const s = diff > 0 ? "+" : "-";
      if (c > 0 && p > 0) return `${s} ${c} كرتونة و ${p} قطعة (${diff} قطعة)`;
      if (c > 0) return `${s} ${c} كرتونة (${diff} قطعة)`;
      return `${sign}${diff} قطعة`;
    }
    return `${sign}${diff} قطعة`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (resultingBalanceBase < 0) {
      setError("الرصيد النهائي لا يمكن أن يكون سالباً");
      return;
    }

    if (diffBase === 0) {
      setError("لم تقم بإجراء أي تغيير على الكمية");
      return;
    }

    const finalReason = reason === "أخرى" ? customReason.trim() : reason;
    if (reason === "أخرى" && !finalReason) {
      setError("اكتب سبب التعديل");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          storeVariantId: item.variantId,
          mode,
          targetQuantityBase: mode === "set" ? targetBase : undefined,
          deltaQuantityBase: mode === "delta" ? deltaBase : undefined,
          reason: finalReason,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل تعديل كمية المخزون");
      }

      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "حدث خطأ غير متوقع");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="تعديل الكمية (جرد وتسوية)"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <Button
            kind="primary"
            size="lg"
            type="submit"
            disabled={isSubmitting || resultingBalanceBase < 0}
            onClick={handleSubmit}
            style={{ flex: 1 }}
          >
            {isSubmitting ? "جاري الحفظ..." : "حفظ التعديل"}
          </Button>
          <Button
            kind="soft"
            size="lg"
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
          >
            إلغاء
          </Button>
        </div>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {/* Item Info Box */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--sf2, #fbf7ef)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <b style={{ fontSize: 15, color: "var(--ink)" }}>
              {item.productName} {item.flavor ? `(${item.flavor})` : ""}
            </b>
            <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 2 }}>
              {item.unitMode !== "weight" && packQty > 1 && (
                <span>الكرتونة {packQty} قطعة &bull; </span>
              )}
              سعر البيع: {formatMoney(item.sellPricePiasters)}
            </div>
          </div>
          <div style={{ textAlign: "left" }}>
            <span
              style={{ fontSize: 11.5, color: "var(--ink2)", display: "block" }}
            >
              الرصيد الحالي
            </span>
            <b
              style={{
                fontSize: 14,
                color:
                  item.currentStockBase <= 0
                    ? "var(--red, #cf3c3c)"
                    : "var(--ink)",
              }}
            >
              {isWeight
                ? `${(item.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`
                : packQty > 1
                  ? `${Math.floor(item.currentStockBase / packQty)} كرتونة و ${item.currentStockBase % packQty} قطعة`
                  : `${item.currentStockBase} قطعة`}
            </b>
          </div>
        </div>

        {/* Mode Selector */}
        <div>
          <label
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--ink2)",
              marginBottom: 6,
              display: "block",
            }}
          >
            طريقة التعديل
          </label>
          <Seg
            options={[
              ["set", "رصيد فعلي (جرد)"],
              ["delta", "إضافة / خصم (+ / -)"],
            ]}
            value={mode}
            onChange={(val) => setMode(val as "set" | "delta")}
          />
        </div>

        {/* Mode 1: Set Final Balance */}
        {mode === "set" ? (
          <div>
            {!isWeight ? (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {packQty > 1 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 10,
                    }}
                  >
                    <Field label="عدد الكراتين الفعلي">
                      <input
                        type="number"
                        min="0"
                        value={setCartons}
                        onChange={(e) => setSetCartons(e.target.value)}
                        placeholder="0"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1.5px solid var(--line)",
                          fontSize: 15,
                          fontWeight: 700,
                          boxSizing: "border-box",
                        }}
                      />
                    </Field>
                    <Field label="قطع فرط إضافية">
                      <input
                        type="number"
                        min="0"
                        value={setPieces}
                        onChange={(e) => setSetPieces(e.target.value)}
                        placeholder="0"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1.5px solid var(--line)",
                          fontSize: 15,
                          fontWeight: 700,
                          boxSizing: "border-box",
                        }}
                      />
                    </Field>
                  </div>
                ) : (
                  <Field label="إجمالي القطع الفعلية">
                    <input
                      type="number"
                      min="0"
                      value={setPieces}
                      onChange={(e) => setSetPieces(e.target.value)}
                      placeholder="0"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                        fontSize: 15,
                        fontWeight: 700,
                        boxSizing: "border-box",
                      }}
                    />
                  </Field>
                )}
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px",
                  gap: 10,
                }}
              >
                <Field label="الوزن الفعلي بالمخزن">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={setWeight}
                    onChange={(e) => setSetWeight(e.target.value)}
                    placeholder="0"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                      fontSize: 15,
                      fontWeight: 700,
                      boxSizing: "border-box",
                    }}
                  />
                </Field>
                <Field label="الوحدة">
                  <select
                    value={weightUnit}
                    onChange={(e) =>
                      setWeightUnit(e.target.value as "kg" | "g")
                    }
                    style={{
                      width: "100%",
                      padding: "10px 8px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                      fontSize: 14,
                      fontWeight: 700,
                      height: 44,
                      boxSizing: "border-box",
                      background: "var(--sf)",
                    }}
                  >
                    <option value="kg">كيلو (كجم)</option>
                    <option value="g">جرام</option>
                  </select>
                </Field>
              </div>
            )}

            {/* Calculated Difference Badge */}
            <div
              className={`${styles.diffBadge} ${
                diffBase > 0
                  ? styles.diffPositive
                  : diffBase < 0
                    ? styles.diffNegative
                    : styles.diffNeutral
              }`}
            >
              <span>فرق التسوية:</span>
              <b>{formatQtyDiff(diffBase)}</b>
            </div>
          </div>
        ) : (
          /* Mode 2: Add or Deduct Delta */
          <div>
            <div style={{ marginBottom: 10 }}>
              <label
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "var(--ink2)",
                  marginBottom: 6,
                  display: "block",
                }}
              >
                نوع العملية
              </label>
              <Seg
                options={[
                  ["add", "+ إضافة كمية"],
                  ["sub", "- خصم كمية"],
                ]}
                value={deltaSign}
                onChange={(val) => setDeltaSign(val as "add" | "sub")}
              />
            </div>

            {!isWeight ? (
              packQty > 1 ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <Field label="عدد الكراتين">
                    <input
                      type="number"
                      min="0"
                      value={deltaCartons}
                      onChange={(e) => setDeltaCartons(e.target.value)}
                      placeholder="0"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                        fontSize: 15,
                        fontWeight: 700,
                        boxSizing: "border-box",
                      }}
                    />
                  </Field>
                  <Field label="قطع إضافية">
                    <input
                      type="number"
                      min="0"
                      value={deltaPieces}
                      onChange={(e) => setDeltaPieces(e.target.value)}
                      placeholder="0"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                        fontSize: 15,
                        fontWeight: 700,
                        boxSizing: "border-box",
                      }}
                    />
                  </Field>
                </div>
              ) : (
                <Field label="الكمية بالقطع">
                  <input
                    type="number"
                    min="0"
                    value={deltaPieces}
                    onChange={(e) => setDeltaPieces(e.target.value)}
                    placeholder="0"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                      fontSize: 15,
                      fontWeight: 700,
                      boxSizing: "border-box",
                    }}
                  />
                </Field>
              )
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px",
                  gap: 10,
                }}
              >
                <Field label="الوزن">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={deltaWeight}
                    onChange={(e) => setDeltaWeight(e.target.value)}
                    placeholder="0"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                      fontSize: 15,
                      fontWeight: 700,
                      boxSizing: "border-box",
                    }}
                  />
                </Field>
                <Field label="الوحدة">
                  <select
                    value={weightUnit}
                    onChange={(e) =>
                      setWeightUnit(e.target.value as "kg" | "g")
                    }
                    style={{
                      width: "100%",
                      padding: "10px 8px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                      fontSize: 14,
                      fontWeight: 700,
                      height: 44,
                      boxSizing: "border-box",
                      background: "var(--sf)",
                    }}
                  >
                    <option value="kg">كيلو (كجم)</option>
                    <option value="g">جرام</option>
                  </select>
                </Field>
              </div>
            )}

            {/* Calculated Resulting Balance */}
            <div
              className={`${styles.diffBadge} ${
                resultingBalanceBase < 0
                  ? styles.diffNegative
                  : styles.diffNeutral
              }`}
            >
              <span>الرصيد الناتج بعد التعديل:</span>
              <b>
                {isWeight
                  ? `${(resultingBalanceBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`
                  : packQty > 1
                    ? `${Math.floor(resultingBalanceBase / packQty)} كرتونة و ${resultingBalanceBase % packQty} قطعة`
                    : `${resultingBalanceBase} قطعة`}
              </b>
            </div>
          </div>
        )}

        {/* Reason Field */}
        <Field label="سبب التعديل">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
              fontWeight: 700,
              boxSizing: "border-box",
              background: "var(--sf)",
            }}
          >
            <option value="جرد دوري">جرد دوري وتسوية فعلية</option>
            <option value="تالف أو منتهي الصلاحية">
              تالف أو منتهي الصلاحية
            </option>
            <option value="خطأ في التسجيل السابق">تصحيح خطأ تسجيل سابق</option>
            <option value="تسوية عجز مخزن">تسوية عجز مخزن</option>
            <option value="هدية أو بضاعة مجانية">بضاعة مجانية / عينات</option>
            <option value="أخرى">سبب آخر (تحديد يدوي)</option>
          </select>
        </Field>

        {reason === "أخرى" && (
          <Field label="اكتب سبب التعديل">
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="اكتب التوضيح هنا..."
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </Field>
        )}

        {error && (
          <div
            style={{
              color: "var(--red, #cf3c3c)",
              fontSize: 13,
              fontWeight: 700,
              background: "rgba(207, 60, 60, 0.08)",
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
export default AdjustStockModal;
