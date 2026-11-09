"use client";

import React, { useState, useMemo } from "react";
import { Modal, Button, Icon } from "@/client/shared/ui";
import { formatMoney } from "@/client/shared/i18n";
import type { StockInventoryItem } from "@/client/shared/store-items";

interface EditStockModalProps {
  item: StockInventoryItem;
  onClose: () => void;
  onSaved: () => void;
}

export function EditStockModal({
  item,
  onClose,
  onSaved,
}: EditStockModalProps) {
  const isWeight = item.unitMode === "weight";
  const pack = item.packQty || 1;
  const hasCartons = !isWeight && pack > 1;

  // Initial values based on current stock
  const initialCartons = hasCartons
    ? Math.floor(Math.max(0, item.currentStockBase) / pack)
    : 0;
  const initialPieces = hasCartons
    ? Math.max(0, item.currentStockBase) % pack
    : Math.max(0, item.currentStockBase);
  const initialWeightKg = isWeight
    ? (Math.max(0, item.currentStockBase) / 1000).toString()
    : "";

  const [cartonsInput, setCartonsInput] = useState(
    hasCartons ? initialCartons.toString() : "0",
  );
  const [piecesInput, setPiecesInput] = useState(initialPieces.toString());
  const [weightKgInput, setWeightKgInput] = useState(initialWeightKg);
  const [weightUnit, setWeightUnit] = useState<"kg" | "g">("kg");
  const [reason, setReason] = useState<string>("جرد دوري وتصحيح رصيد");
  const [customReason, setCustomReason] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calculate new target base quantity
  const targetQuantityBase = useMemo(() => {
    if (isWeight) {
      const w = parseFloat(weightKgInput) || 0;
      if (weightUnit === "kg") {
        return Math.max(0, Math.round(w * 1000));
      }
      return Math.max(0, Math.round(w));
    }

    const c = parseInt(cartonsInput, 10) || 0;
    const p = parseInt(piecesInput, 10) || 0;
    return Math.max(0, c * pack + p);
  }, [isWeight, weightKgInput, weightUnit, cartonsInput, piecesInput, pack]);

  // Delta difference calculation
  const delta = targetQuantityBase - item.currentStockBase;

  const formatDelta = () => {
    if (delta === 0) return "لا يوجد تغيير في الرصيد";
    const sign = delta > 0 ? "+" : "";
    if (isWeight) {
      const kg = delta / 1000;
      return `${sign}${kg.toFixed(2)} كجم (${delta > 0 ? "زيادة في المخزن" : "عجز أو هالك"})`;
    }
    if (hasCartons) {
      const c = Math.floor(Math.abs(delta) / pack);
      const p = Math.abs(delta) % pack;
      let text = "";
      if (c > 0 && p > 0) text = `${c} كرتونة و ${p} قطعة`;
      else if (c > 0) text = `${c} كرتونة`;
      else text = `${p} قطعة`;
      return `${sign}${text} (${delta > 0 ? "زيادة في المخزن" : "عجز أو هالك"})`;
    }
    return `${sign}${delta} قطعة (${delta > 0 ? "زيادة في المخزن" : "عجز أو هالك"})`;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const finalReason =
      reason === "أخرى" ? customReason.trim() || "تعديل يدوي" : reason;

    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "adjust",
          storeVariantId: item.variantId,
          mode: "set",
          targetQuantityBase,
          reason: finalReason,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل تعديل المخزون");
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "حدث خطأ أثناء حفظ التعديل",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={`تعديل مخزون: ${item.productName}`}
      onClose={onClose}
      footer={
        <div
          style={{
            display: "flex",
            gap: 10,
            width: "100%",
            justifyContent: "flex-end",
          }}
        >
          <Button
            kind="soft"
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            إلغاء
          </Button>
          <Button
            kind="primary"
            type="button"
            onClick={handleSave}
            disabled={isSubmitting}
          >
            <Icon n="check" s={16} />
            <span>{isSubmitting ? "جارٍ الحفظ..." : "حفظ التعديل"}</span>
          </Button>
        </div>
      }
    >
      <form
        onSubmit={handleSave}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {error && (
          <div
            style={{
              padding: "10px 12px",
              background: "#fee2e2",
              color: "#991b1b",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        )}

        {/* Current Stock Banner */}
        <div
          style={{
            padding: "12px 14px",
            background: "var(--sf2, #fbf7ef)",
            borderRadius: 10,
            border: "1px solid var(--line, #e2ded5)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <span
              style={{ fontSize: 12, color: "var(--ink2)", display: "block" }}
            >
              الرصيد الحالي المسجل بالسيستم:
            </span>
            <b style={{ fontSize: 16, color: "var(--ink)" }}>
              {isWeight
                ? `${(item.currentStockBase / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} كجم`
                : hasCartons
                  ? `${Math.floor(item.currentStockBase / pack)} كرتونة و ${item.currentStockBase % pack} قطعة`
                  : `${item.currentStockBase} قطعة`}
            </b>
          </div>
          {item.sellPricePiasters > 0 && (
            <div style={{ textAlign: "left" }}>
              <span
                style={{ fontSize: 11, color: "var(--ink2)", display: "block" }}
              >
                سعر البيع:
              </span>
              <b style={{ fontSize: 14, color: "var(--ok, #108e5c)" }}>
                {formatMoney(item.sellPricePiasters)}
              </b>
            </div>
          )}
        </div>

        {/* Stock inputs */}
        {isWeight ? (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <label
                style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}
              >
                الرصيد الفعلي الجديد بالمحل:
              </label>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setWeightUnit("kg")}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    border: "1px solid var(--line)",
                    background:
                      weightUnit === "kg"
                        ? "var(--br, #5a7d5a)"
                        : "transparent",
                    color: weightUnit === "kg" ? "#fff" : "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  كجم
                </button>
                <button
                  type="button"
                  onClick={() => setWeightUnit("g")}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    border: "1px solid var(--line)",
                    background:
                      weightUnit === "g" ? "var(--br, #5a7d5a)" : "transparent",
                    color: weightUnit === "g" ? "#fff" : "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  جرام
                </button>
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="number"
                step="any"
                min="0"
                value={weightKgInput}
                onChange={(e) => setWeightKgInput(e.target.value)}
                placeholder="0"
                style={{
                  width: "100%",
                  padding: "10px 12px",
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
                  color: "var(--ink2)",
                  fontWeight: 600,
                }}
              >
                {weightUnit === "kg" ? "كجم" : "جرام"}
              </span>
            </div>
          </div>
        ) : hasCartons ? (
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 8,
                color: "var(--ink)",
              }}
            >
              الرصيد الفعلي الجديد (كراتين وقطع):
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <div>
                <span
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    color: "var(--ink2)",
                    marginBottom: 4,
                  }}
                >
                  عدد الكراتين (الكرتونة {pack} ق):
                </span>
                <input
                  type="number"
                  min="0"
                  value={cartonsInput}
                  onChange={(e) => setCartonsInput(e.target.value)}
                  placeholder="0"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1.5px solid var(--line)",
                    fontSize: 16,
                    fontWeight: 700,
                    background: "var(--sf)",
                    color: "var(--ink)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <span
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    color: "var(--ink2)",
                    marginBottom: 4,
                  }}
                >
                  القطع الفردية الزائدة:
                </span>
                <input
                  type="number"
                  min="0"
                  value={piecesInput}
                  onChange={(e) => setPiecesInput(e.target.value)}
                  placeholder="0"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1.5px solid var(--line)",
                    fontSize: 16,
                    fontWeight: 700,
                    background: "var(--sf)",
                    color: "var(--ink)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6 }}>
              الإجمالي الفعلي بعد التعديل: <b>{targetQuantityBase} قطعة</b>
            </div>
          </div>
        ) : (
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 6,
                color: "var(--ink)",
              }}
            >
              الرصيد الفعلي الجديد بالقطع:
            </label>
            <input
              type="number"
              min="0"
              value={piecesInput}
              onChange={(e) => setPiecesInput(e.target.value)}
              placeholder="0"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1.5px solid var(--line)",
                fontSize: 16,
                fontWeight: 700,
                background: "var(--sf)",
                color: "var(--ink)",
                boxSizing: "border-box",
              }}
            />
          </div>
        )}

        {/* Live Delta / Difference Badge */}
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            backgroundColor:
              delta === 0
                ? "var(--sf2)"
                : delta > 0
                  ? "rgba(16,142,92,0.1)"
                  : "rgba(207,60,60,0.1)",
            border: `1px solid ${delta === 0 ? "var(--line)" : delta > 0 ? "rgba(16,142,92,0.3)" : "rgba(207,60,60,0.3)"}`,
            color:
              delta === 0
                ? "var(--ink2)"
                : delta > 0
                  ? "var(--ok, #108e5c)"
                  : "var(--red, #cf3c3c)",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon n={delta > 0 ? "check" : delta < 0 ? "alert" : "info"} s={16} />
          <span>فرق الجرد: {formatDelta()}</span>
        </div>

        {/* Reason */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 6,
              color: "var(--ink)",
            }}
          >
            سبب التعديل:
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 13.5,
              background: "var(--sf)",
              color: "var(--ink)",
              boxSizing: "border-box",
            }}
          >
            <option value="جرد دوري وتصحيح رصيد">جرد دوري وتصحيح رصيد</option>
            <option value="تصحيح خطأ تسجيل سابق">تصحيح خطأ تسجيل سابق</option>
            <option value="بضاعة تالفة أو منتهية الصلاحية">
              بضاعة تالفة أو منتهية الصلاحية
            </option>
            <option value="تسوية عجز">تسوية عجز</option>
            <option value="أخرى">أخرى (كتابة سبب مخصص)...</option>
          </select>
          {reason === "أخرى" && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="اكتب سبب تعديل المخزون هنا..."
              style={{
                width: "100%",
                padding: "8px 12px",
                marginTop: 8,
                borderRadius: 8,
                border: "1.5px solid var(--line)",
                fontSize: 13,
                background: "var(--sf)",
                color: "var(--ink)",
                boxSizing: "border-box",
              }}
            />
          )}
        </div>
      </form>
    </Modal>
  );
}
