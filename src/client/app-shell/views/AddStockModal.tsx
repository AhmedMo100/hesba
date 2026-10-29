"use client";

import React, { useState, useMemo } from "react";
import { Modal, Button, Field } from "../../shared/ui";
import { formatMoney } from "../../shared/i18n";

export interface StockProductOption {
  variantId: string;
  productId: string;
  productName: string;
  flavor?: string | null;
  unitMode: "piece" | "weight";
  packQty: number;
  currentStockBase: number;
}

export interface AddStockModalProps {
  options: StockProductOption[];
  presetVariantId?: string | null;
  onClose: () => void;
  onAdded: () => void;
}

export function AddStockModal({
  options,
  presetVariantId,
  onClose,
  onAdded,
}: AddStockModalProps) {
  const [selectedVariantId, setSelectedVariantId] = useState(
    presetVariantId || (options[0]?.variantId ?? ""),
  );
  const [cartons, setCartons] = useState("");
  const [pieces, setPieces] = useState("");
  const [kg, setKg] = useState("");
  const [costEgp, setCostEgp] = useState("");
  const [expiry, setExpiry] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [batchCode, setBatchCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedOption = useMemo(
    () => options.find((o) => o.variantId === selectedVariantId),
    [options, selectedVariantId],
  );

  // Compute total base quantity
  const totalBaseQty = useMemo(() => {
    if (!selectedOption) return 0;
    if (selectedOption.unitMode === "weight") {
      const kgNum = parseFloat(kg) || 0;
      return Math.round(kgNum * 1000); // grams
    } else {
      const cartonsNum = parseInt(cartons, 10) || 0;
      const piecesNum = parseInt(pieces, 10) || 0;
      const packQty = selectedOption.packQty || 1;
      return cartonsNum * packQty + piecesNum;
    }
  }, [selectedOption, kg, cartons, pieces]);

  // Compute unit cost in piasters
  const unitCostEgp = useMemo(() => {
    const costNum = parseFloat(costEgp) || 0;
    if (costNum <= 0 || totalBaseQty <= 0) return 0;
    if (selectedOption?.unitMode === "weight") {
      // per kg
      return (costNum / totalBaseQty) * 1000;
    }
    return costNum / totalBaseQty;
  }, [costEgp, totalBaseQty, selectedOption]);

  const addDaysToToday = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0]!;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!selectedVariantId) {
      newErrors.product = "اختر المنتج أولاً";
    }

    if (totalBaseQty <= 0) {
      newErrors.qty =
        selectedOption?.unitMode === "weight"
          ? "اكتب وزن البضاعة التي دخلت"
          : "اكتب الكمية التي دخلت";
    }

    const costNum = parseFloat(costEgp);
    if (isNaN(costNum) || costNum < 0) {
      newErrors.cost = "اكتب إجمالي سعر الشراء";
    }

    if (!noExpiry && !expiry) {
      newErrors.expiry = 'اختر تاريخ الصلاحية أو اضغط "مفيش صلاحية"';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const costPiasters = Math.round(costNum * 100);

      const payload = {
        action: "add",
        storeVariantId: selectedVariantId,
        quantityBase: totalBaseQty,
        costPricePiasters: costPiasters,
        expiryDate: noExpiry ? null : expiry || null,
        batchCode: batchCode.trim() || null,
      };

      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || "فشل تسجيل البضاعة في المخزون");
      }

      onAdded();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
      setErrors({ submit: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const quickExpiryChips = [
    { label: "بعد شهر", days: 30 },
    { label: "بعد 3 شهور", days: 90 },
    { label: "بعد 6 شهور", days: 180 },
    { label: "بعد سنة", days: 365 },
  ];

  return (
    <Modal
      title="إضافة للمخزون"
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
            إضافة للمخزون
          </Button>
        </>
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {errors.submit && (
          <div
            style={{
              color: "var(--red, #cf3c3c)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {errors.submit}
          </div>
        )}

        <Field label="المنتج" err={errors.product}>
          <select
            value={selectedVariantId}
            onChange={(e) => {
              setSelectedVariantId(e.target.value);
              setErrors({});
            }}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1.5px solid var(--line)",
              fontSize: 14,
            }}
          >
            {options.map((opt) => (
              <option key={opt.variantId} value={opt.variantId}>
                {opt.productName} {opt.flavor ? `(${opt.flavor})` : ""} —
                الموجود:{" "}
                {opt.unitMode === "weight"
                  ? `${opt.currentStockBase / 1000} كجم`
                  : `${opt.currentStockBase} قطعة`}
              </option>
            ))}
          </select>
        </Field>

        {selectedOption && (
          <>
            {selectedOption.unitMode === "weight" ? (
              <Field label="الوزن اللي دخل (بالكيلو)" err={errors.qty}>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                  placeholder="مثال: 5.5"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1.5px solid var(--line)",
                  }}
                />
              </Field>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                {selectedOption.packQty > 1 && (
                  <Field label="كراتين">
                    <input
                      type="number"
                      min="0"
                      value={cartons}
                      onChange={(e) => setCartons(e.target.value)}
                      placeholder="عدد الكراتين"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1.5px solid var(--line)",
                      }}
                    />
                  </Field>
                )}
                <Field
                  label={
                    selectedOption.packQty > 1 ? "قطع زيادة" : "الكمية (قطع)"
                  }
                  err={errors.qty}
                >
                  <input
                    type="number"
                    min="0"
                    value={pieces}
                    onChange={(e) => setPieces(e.target.value)}
                    placeholder="عدد القطع"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1.5px solid var(--line)",
                    }}
                  />
                </Field>
              </div>
            )}

            <Field
              label="إجمالي سعر الشراء (ج.م)"
              err={errors.cost}
              hint={
                unitCostEgp > 0
                  ? selectedOption.unitMode === "weight"
                    ? `الكيلو بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                    : `القطعة بـ ${formatMoney(Math.round(unitCostEgp * 100))}`
                  : "السعر الإجمالي اللي دفعته للكمية دي"
              }
            >
              <input
                type="number"
                step="0.5"
                min="0"
                value={costEgp}
                onChange={(e) => setCostEgp(e.target.value)}
                placeholder="مثال: 250"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                }}
              />
            </Field>

            <Field label="تاريخ الصلاحية" err={errors.expiry}>
              <input
                type="date"
                value={expiry}
                disabled={noExpiry}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => {
                  setExpiry(e.target.value);
                  setNoExpiry(false);
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                  background: noExpiry ? "var(--sf2)" : "var(--sf)",
                }}
              />
            </Field>

            <div
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                marginTop: -6,
              }}
            >
              {quickExpiryChips.map((chip) => (
                <button
                  type="button"
                  key={chip.days}
                  style={{
                    background: "var(--sf)",
                    border: "1px solid var(--line)",
                    borderRadius: 16,
                    padding: "4px 10px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setNoExpiry(false);
                    setExpiry(addDaysToToday(chip.days));
                  }}
                >
                  {chip.label}
                </button>
              ))}
              <button
                type="button"
                style={{
                  background: noExpiry ? "var(--ink)" : "var(--sf)",
                  color: noExpiry ? "#fff" : "var(--ink)",
                  border: "1px solid var(--line)",
                  borderRadius: 16,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                onClick={() => {
                  setNoExpiry(!noExpiry);
                  if (!noExpiry) setExpiry("");
                }}
              >
                مفيش صلاحية
              </button>
            </div>

            <Field label="رقم التشغيلة / كود الشحنة (اختياري)">
              <input
                type="text"
                value={batchCode}
                onChange={(e) => setBatchCode(e.target.value)}
                placeholder="مثال: B-104"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1.5px solid var(--line)",
                }}
              />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
